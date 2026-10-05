import React from 'react';
import { useSearchParams } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { StepKey } from '@/lib/gstr9/engine';

/** Inline link to another step of the workspace; keeps the open client / FY in the URL. */
export const StepLink: React.FC<{
  step: StepKey;
  /** Further search params to set, e.g. the Annexure tab. */
  extra?: Record<string, string>;
  children: React.ReactNode;
  className?: string;
}> = ({ step, extra, children, className }) => {
  const [params, setParams] = useSearchParams();
  return (
    <button
      type="button"
      onClick={() => {
        const next = new URLSearchParams(params);
        next.set('step', step);
        Object.entries(extra ?? {}).forEach(([k, v]) => next.set(k, v));
        setParams(next);
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }}
      className={cn('inline-flex items-center gap-0.5 font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm', className)}
    >
      {children}
      <ArrowRight className="h-3 w-3" />
    </button>
  );
};

export default StepLink;
