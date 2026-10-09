// The line under a Notices page's title says something only when something is
// wrong (the firm's request of 9 October 2026: the routine figures there were
// "irrelevant on almost every screen & very boring to read"). Each problem is
// one short sentence with where to fix it; a normal day shows nothing.
import React from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle } from 'lucide-react';

export interface Problem { key: string; text: string; to?: string }

export const ProblemLine: React.FC<{ problems: (Problem | null | false | undefined)[] }> = ({ problems }) => {
  const list = problems.filter((p): p is Problem => !!p);
  if (!list.length) return null;
  return (
    <p className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs font-medium text-destructive-strong" role="status">
      <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden />
      {list.map((p) => (p.to
        ? <Link key={p.key} to={p.to} className="underline-offset-2 hover:underline">{p.text} →</Link>
        : <span key={p.key}>{p.text}</span>))}
    </p>
  );
};

export default ProblemLine;
