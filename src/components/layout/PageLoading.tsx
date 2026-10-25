import React from 'react';
import { Loader2 } from 'lucide-react';

/** Shown while a page's code is fetched (each page is its own chunk, App.tsx). */
export const PageLoading: React.FC = () => (
  <div className="flex min-h-[40vh] items-center justify-center" role="status" aria-live="polite">
    <Loader2 className="h-6 w-6 animate-spin text-primary" aria-hidden />
    <span className="sr-only">Loading…</span>
  </div>
);

export default PageLoading;
