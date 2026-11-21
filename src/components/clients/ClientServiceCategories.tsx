import React from 'react';
import { Checkbox } from '@/components/ui/checkbox';

/**
 * Which of the firm's services a client takes, in any combination. Each
 * module lists only its own clients (migration 20261121100000):
 *   Returns filing        clients.returns_filing         -> Filing Status
 *   GSTR-9 / 9C           clients.annual_return_assigned -> Annual Return
 *   Notices & Litigation  clients.notices_handled        -> Notices & Litigation
 */
export interface ClientServices {
  returns: boolean;
  annualReturn: boolean;
  notices: boolean;
}

const OPTIONS: { key: keyof ClientServices; label: string; hint: string }[] = [
  { key: 'returns', label: 'Returns filing', hint: 'Shown in Filing Status and the dashboard\'s filing counts.' },
  { key: 'annualReturn', label: 'GSTR-9 / 9C', hint: 'Shown in Annual Return.' },
  { key: 'notices', label: 'Notices & Litigation', hint: 'Shown in Notices & Litigation and synced for notices.' },
];

export const hasAnyService = (s: ClientServices) => s.returns || s.annualReturn || s.notices;

export const ClientServiceCategories: React.FC<{
  value: ClientServices;
  onChange: (next: ClientServices) => void;
  error?: string;
}> = ({ value, onChange, error }) => (
  <div className="space-y-1.5">
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
      {OPTIONS.map((o) => {
        const id = `service-${o.key}`;
        const on = value[o.key];
        return (
          <label
            key={o.key}
            htmlFor={id}
            className={`flex items-start gap-2 p-3 border rounded-lg cursor-pointer transition-colors ${
              on ? 'border-primary bg-primary/5' : 'hover:bg-muted/50'
            }`}
          >
            <Checkbox
              id={id}
              checked={on}
              onCheckedChange={(v) => onChange({ ...value, [o.key]: v === true })}
              className="mt-0.5"
            />
            <div>
              <span className="text-sm font-medium block">{o.label}</span>
              <p className="text-xs text-muted-foreground mt-0.5">{o.hint}</p>
            </div>
          </label>
        );
      })}
    </div>
    {error && <p className="text-sm text-destructive">{error}</p>}
  </div>
);
