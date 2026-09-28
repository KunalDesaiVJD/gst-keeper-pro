import * as React from 'react';
import { Badge as KitBadge, type BadgeProps } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

/**
 * The kit's Badge with readable tones for this module. The kit's success /
 * warning / info / destructive variants put white text on a mid-tone fill
 * (2.1–3.8:1 — under AA for 10–12 px text). Here they are a light tint of the
 * tone with foreground text and a tone-coloured border. Destructive (open
 * counts, "Reason needed", "Pull failed") is a card-coloured pill with a red
 * border, so it stays legible on the navy active step in the step rail too.
 * Other variants pass through unchanged.
 */
const TONE: Partial<Record<NonNullable<BadgeProps['variant']>, string>> = {
  success: 'border-success/50 bg-success/15 text-foreground hover:bg-success/15',
  warning: 'border-warning/60 bg-warning/20 text-foreground hover:bg-warning/20',
  info: 'border-info/50 bg-info/15 text-foreground hover:bg-info/15',
  destructive: 'border-destructive bg-card text-foreground hover:bg-card',
};

export function Badge({ variant, className, ...props }: BadgeProps) {
  const tone = variant ? TONE[variant] : undefined;
  return <KitBadge variant={tone ? 'outline' : variant} className={cn(tone, className)} {...props} />;
}
