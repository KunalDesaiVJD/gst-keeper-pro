import React from 'react';
import { ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { g9TieGuide, type G9TieKey } from '@/lib/gstr9/g9TieGuide';
import { useGoFigure } from '../figure/FigLink';
import { c9Row } from './sourceTargets';

/**
 * What a GSTR-9C line the portal checks against the filed GSTR-9 means, and the numbered steps
 * that clear it, each with a button to the table where it is done. Imports nothing from ../ui,
 * which renders it inside the line's pop-over.
 */
export const G9TieGuideView: React.FC<{ lineKey: G9TieKey; compact?: boolean; className?: string; onGo?: () => void }> = ({ lineKey, compact, className, onGo }) => {
  const g = g9TieGuide(lineKey);
  const go = useGoFigure();
  return (
    <div className={cn('space-y-2 text-xs leading-snug', className)}>
      {!compact && <div className="text-sm font-semibold">{g.title}</div>}
      <div>
        <span className="font-medium">What it means. </span>
        {g.meaning}
      </div>
      <div className="text-muted-foreground">
        <span className="font-medium text-foreground">Portal error if uploaded as it is: </span>
        {g.portalError}
      </div>
      <div className="font-medium">How to fix it</div>
      <ol className="list-decimal space-y-1.5 pl-4">
        {g.steps.map((s, i) => (
          <li key={i}>
            {s.text}
            {s.goTo && (
              <Button
                type="button"
                variant="link"
                size="sm"
                className="ml-1 h-auto p-0 text-xs"
                onClick={() => { go(c9Row(s.goTo!.table, s.goTo!.row)); onGo?.(); }}
              >
                {s.goTo.label} <ArrowRight className="ml-0.5 h-3 w-3" />
              </Button>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
};
