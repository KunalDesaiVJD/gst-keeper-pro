// An appeal filed on the portal, shown from the portal's own record of it
// (src/lib/portalAppeal.ts; the firm, 25 October 2026): on the refund page.
import React from 'react';
import { FileText } from 'lucide-react';
import { fmtDate, fmtInr, plural } from '@/lib/noticeFormat';
import type { PortalAppeal } from '@/lib/portalAppeal';
import { periodText } from '@/components/notices/reports/refundModel';
import { cn } from '@/lib/utils';

/** The appeal's facts and files, as the portal records them. */
export const AppealFacts: React.FC<{ a: PortalAppeal; className?: string }> = ({ a, className }) => {
  const per = a.period.from ? periodText(a.period.from, a.period.to) : null;
  const facts: [string, React.ReactNode][] = [
    ['Filed', `${fmtDate(a.filedOn)}${a.signedBy ? ` by ${a.signedBy}` : ''}`],
    ['Status on the portal', a.status ?? '—'],
    ['Against', a.order.ref ? <><span className="font-mono">{a.order.ref}</span>{a.order.kind ? ` (${a.order.kind})` : ''}{a.order.date ? ` of ${fmtDate(a.order.date)}` : ''}</> : '—'],
    ...(a.order.communicated && a.order.communicated !== a.order.date ? [['Order communicated', fmtDate(a.order.communicated)] as [string, React.ReactNode]] : []),
    ...(per ? [['Period', per] as [string, React.ReactNode]] : []),
    ...(a.refundClaimed ? [['Refund claimed', fmtInr(a.refundClaimed)] as [string, React.ReactNode]] : []),
    ...(a.refundGranted !== null && a.refundClaimed ? [['Granted by the order', fmtInr(a.refundGranted)] as [string, React.ReactNode]] : []),
    ['In dispute', a.disputed ? fmtInr(a.disputed) : '—'],
    ...(a.preDeposit ? [['Pre-deposit', fmtInr(a.preDeposit)] as [string, React.ReactNode]] : []),
    ...(a.authority ? [['Before', a.authority] as [string, React.ReactNode]] : []),
  ];
  return (
    <div className={cn('space-y-2 text-xs', className)}>
      <dl className="grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-2">
        {facts.map(([k, v]) => (
          <div key={k} className="flex gap-2"><dt className="w-36 shrink-0 text-muted-foreground">{k}</dt><dd className="min-w-0">{v}</dd></div>
        ))}
      </dl>
      {a.issues.length > 0 && <p><span className="text-muted-foreground">Ground: </span>{a.issues.join('; ')}</p>}
      {a.docs.length > 0 && (
        <div>
          <div className="text-muted-foreground">Filed with it ({plural(a.docs.length, 'file')}, on the portal; not downloaded into the app yet)</div>
          <ul className="mt-1 flex flex-wrap gap-1.5">
            {a.docs.map((d) => (
              <li key={d.id} className="inline-flex items-center gap-1 rounded border border-dashed px-1.5 py-0.5 text-[11px] text-muted-foreground">
                <FileText className="h-3 w-3" aria-hidden />{d.name}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};
