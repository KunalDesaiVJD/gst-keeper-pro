// Small pieces the Portal Autopilot tabs share: a badge in the module's tones,
// the dashed empty box, a load error with Retry, and the link style for counts
// inside a line of text (audit cross-cutting "every count is a link").
import React from 'react';
import { RefreshCw } from 'lucide-react';
import { Badge } from '@/components/gstr9/badge';
import { Note } from '@/components/gstr9/ui';
import { Button } from '@/components/ui/button';
import type { Tone } from '@/lib/autopilot';
import { cn } from '@/lib/utils';

/** A link inside a sentence or a status line: underlined, so it is not told apart by colour alone. */
export const INLINE_LINK = 'font-medium text-primary underline underline-offset-2 hover:text-primary/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm';

export const ToneBadge: React.FC<{ tone: Tone; children: React.ReactNode; className?: string }> = ({ tone, children, className }) => (
  <Badge variant={tone} className={cn('whitespace-nowrap text-[11px] font-medium', className)}>{children}</Badge>
);

export const EmptyBox: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className }) => (
  <div className={cn('rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground', className)}>{children}</div>
);

export const LoadError: React.FC<{ what: string; error: unknown; onRetry: () => void }> = ({ what, error, onRetry }) => (
  <Note tone="warn">
    Couldn't load {what}: {error instanceof Error ? error.message : String(error)}{' '}
    <Button variant="link" className="h-auto p-0 text-xs" onClick={onRetry}><RefreshCw className="mr-1 h-3 w-3" aria-hidden /> Retry</Button>
  </Note>
);
