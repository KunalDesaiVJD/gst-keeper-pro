// The header badge (roadmap Phase 3): while the autopilot is on and clients
// wait for a person, every staff page shows "3 CAPTCHAs" (on the wall now) or
// "12 waiting for a CAPTCHA", linking to the wall. Hidden otherwise, and on the
// Autopilot page itself, which says the same in its status line.
import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { KeyRound } from 'lucide-react';
import { useAutopilotBadge } from '@/lib/autopilot';
import { plural } from '@/lib/noticeFormat';

export const AutopilotBadge: React.FC<{ enabled?: boolean }> = ({ enabled = true }) => {
  const { pathname } = useLocation();
  const q = useAutopilotBadge(enabled);
  const d = q.data;
  if (!enabled || !d?.enabled || d.live + d.waiting <= 0 || pathname === '/notices-autopilot') return null;
  const text = d.live > 0 ? plural(d.live, 'CAPTCHA') : `${d.waiting.toLocaleString('en-IN')} waiting for a CAPTCHA`;
  return (
    <div className="mb-3 flex justify-end md:-mt-2 md:mb-2 md:pr-12">
      <Link to="/notices-autopilot?tab=wall"
        className="inline-flex items-center gap-1.5 rounded-full border border-warning/60 bg-warning/20 px-3 py-1 text-xs font-semibold text-foreground shadow-sm transition-colors hover:bg-warning/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <KeyRound className="h-3.5 w-3.5" aria-hidden />
        {text}
      </Link>
    </div>
  );
};

export default AutopilotBadge;
