import * as React from 'react';
import { Button } from '@/components/ui/button';
import { WS_BTN } from '@/components/workspace/theme';
import { cn } from '@/lib/utils';
import { ArrowRight, Building2, Layers, Settings2, Wallet, History } from 'lucide-react';

/**
 * The first screen of a project with no units: the onboarding job in the order
 * it is done, instead of a bare "No units yet". Steps 1 and 2 open the panels
 * the workspace owns (through window events, as 'builder:open-masters' already
 * does in the other direction); step 3 is the one that unlocks the rest.
 */
export const BuilderGettingStarted: React.FC<{ canEdit: boolean; onImportUnits: () => void }> = ({ canEdit, onImportUnits }) => {
  const fire = (name: string) => () => window.dispatchEvent(new CustomEvent(name));
  const steps: { icon: React.ReactNode; title: string; detail: string; action?: { label: string; run: () => void }; current?: boolean; later?: boolean }[] = [
    {
      icon: <Building2 />,
      title: 'Confirm the client\'s elections',
      detail: 'Which charge heads form the gross amount, delay-interest treatment, metro default. Sent to the client for written confirmation.',
      action: { label: 'Client setup', run: fire('builder:open-setup') },
    },
    {
      icon: <Settings2 />,
      title: 'Check the project settings',
      detail: 'Metro or not (60 / 90 sq m), carpet-area source for the 15% RREP test, document series and the opening cut-off.',
      action: { label: 'Project settings', run: fire('builder:open-project-settings') },
    },
    {
      icon: <Layers />,
      title: 'Import the unit list',
      detail: 'Unit number, type, carpet area, agreement value and charges. Paste from Excel; every unit is classified as you go.',
      action: canEdit ? { label: 'Units & masters', run: onImportUnits } : undefined,
      current: true,
    },
    {
      icon: <History />,
      title: 'Key opening balances',
      detail: 'Only for units already part-taxed before onboarding: value taxed, tax and receipts to date, as on the cut-off.',
      later: true,
    },
    {
      icon: <Wallet />,
      title: 'Record the month\'s receipts',
      detail: 'Type down one amount column per collection run; advances go to Table 11A, invoices absorb them in 11B.',
      later: true,
    },
  ];

  return (
    <div className="mx-auto max-w-3xl py-4">
      <div className="mb-3 text-center">
        <p className="text-sm font-semibold text-foreground">Set up this project</p>
        <p className="text-xs text-muted-foreground">Five steps, done once at onboarding. After this the work is monthly: receipts, invoices, returns.</p>
      </div>
      <ol className="space-y-2">
        {steps.map((s, i) => (
          <li
            key={s.title}
            className={cn(
              'flex items-start gap-3 rounded-lg border px-3 py-2.5',
              s.current ? 'border-primary/50 bg-primary/[0.04] shadow-sm' : 'bg-card',
              s.later && 'opacity-60',
            )}
          >
            <span
              className={cn(
                'flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold',
                s.current ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground',
              )}
            >
              {i + 1}
            </span>
            <span className="mt-0.5 shrink-0 text-primary [&>svg]:h-4 [&>svg]:w-4">{s.icon}</span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium leading-tight">{s.title}</span>
              <span className="block text-xs leading-snug text-muted-foreground">{s.detail}</span>
            </span>
            {s.action && (
              <Button size="sm" variant={s.current ? 'default' : 'outline'} className={cn(WS_BTN, 'shrink-0')} onClick={s.action.run}>
                {s.action.label} <ArrowRight className="h-3.5 w-3.5" />
              </Button>
            )}
            {s.later && <span className="shrink-0 self-center text-[11px] text-muted-foreground">after units</span>}
          </li>
        ))}
      </ol>
    </div>
  );
};

export default BuilderGettingStarted;
