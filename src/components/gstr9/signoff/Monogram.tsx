import React from 'react';
import { ShieldCheck } from 'lucide-react';
import { monogram } from '@/lib/gstr9/signoffFlow';
import { cn } from '@/lib/utils';

/** A person's two letters in a circle; "me" is filled; nobody is a dashed "?"; any manager is a shield. */
export const Monogram: React.FC<{ name?: string | null; me?: boolean; kind?: 'person' | 'nobody' | 'managers'; muted?: boolean; className?: string }> = ({
  name, me, kind = 'person', muted, className,
}) => {
  const base = 'inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full text-[9px] font-semibold leading-none';
  if (kind === 'nobody') return <span aria-hidden className={cn(base, 'border border-dashed border-muted-foreground/60 font-normal text-muted-foreground', className)}>?</span>;
  if (kind === 'managers') {
    return (
      <span aria-hidden className={cn(base, 'bg-muted text-muted-foreground', className)}>
        <ShieldCheck className="h-3 w-3" />
      </span>
    );
  }
  return (
    <span aria-hidden className={cn(base, me ? 'bg-primary text-primary-foreground' : muted ? 'bg-muted text-muted-foreground' : 'bg-primary/10 text-primary', className)}>
      {monogram(name)}
    </span>
  );
};

export default Monogram;
