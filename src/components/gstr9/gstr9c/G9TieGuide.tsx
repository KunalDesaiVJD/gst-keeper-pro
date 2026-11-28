import React from 'react';
import { ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { g9TieGuide, type G9TieKey } from '@/lib/gstr9/g9TieGuide';
import { useGoFigure } from '../figure/FigLink';
import { c9Row } from './sourceTargets';

/** One line and two short steps for a 5Q / 9Q cell the portal checks; `go` adds a button to the cell. */
export const G9TieGuideView: React.FC<{ lineKey: G9TieKey; go?: boolean; className?: string; children?: React.ReactNode }> = ({ lineKey, go, className, children }) => {
  const g = g9TieGuide(lineKey);
  const goFig = useGoFigure();
  return (
    <div className={cn('space-y-1 text-xs leading-snug', className)}>
      <div>{g.why}</div>
      <ol className="list-decimal space-y-0.5 pl-4 text-muted-foreground">
        {g.steps.map((s) => <li key={s}>{s}</li>)}
      </ol>
      {children}
      {go && (
        <Button type="button" variant="link" size="sm" className="h-auto p-0 text-xs" onClick={() => goFig(c9Row(g.cell === '5Q' ? '5' : '9', 'Q'))}>
          Go to {g.cell} <ArrowRight className="ml-0.5 h-3 w-3" />
        </Button>
      )}
    </div>
  );
};
