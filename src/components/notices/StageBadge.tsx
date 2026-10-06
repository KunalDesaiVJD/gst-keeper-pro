import React from 'react';
import { Badge } from '@/components/gstr9/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { stageDef } from '@/lib/noticeStages';
import { fmtDateTime } from '@/lib/noticeFormat';
import { cn } from '@/lib/utils';

/**
 * A notice's or matter's stage as a readable, toned badge (audit U-13-3,
 * U-42-1): blocked stages amber, filed green, orders and appeals red-bordered.
 * The tooltip says what the stage means and since when.
 */
export const StageBadge: React.FC<{
  stage: string | null | undefined;
  since?: string | null;
  by?: string | null;
  className?: string;
}> = ({ stage, since, by, className }) => {
  const def = stageDef(stage);
  const badge = (
    <Badge variant={def.tone === 'secondary' ? 'secondary' : def.tone} className={cn('whitespace-nowrap text-[11px] font-medium', className)}>
      {def.label}
    </Badge>
  );
  return (
    <Tooltip>
      <TooltipTrigger asChild><span className="inline-flex">{badge}</span></TooltipTrigger>
      <TooltipContent className="max-w-xs text-xs">
        <div className="font-medium">{def.label}</div>
        <div className="text-muted-foreground">{def.description}</div>
        {since && <div className="mt-1">Since {fmtDateTime(since)}{by ? ` · ${by}` : ''}</div>}
      </TooltipContent>
    </Tooltip>
  );
};

export default StageBadge;
