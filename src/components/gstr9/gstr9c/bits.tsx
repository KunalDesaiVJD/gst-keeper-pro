import React from 'react';
import { MessageSquareText } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { totalTax } from '@/lib/gstr9/engine';
import type { Gstr9cDoc } from '@/lib/gstr9/types';
import { fmtMoney } from '../grid/money';
import { JustifyControl, KpiTile, useDiffLine } from '../ui';
import { useWorkspace } from '../WorkspaceContext';
import { HEAD_ORDER, headsText } from './formLines';

type ReasonField = 't6Reasons' | 't8Reasons' | 't10Reasons' | 't13Reasons' | 't15Reasons';

/**
 * A "Reasons for un-reconciled difference" table of the form (6, 8, 10, 13,
 * 15). Autosaves as typed; offers the justification already written against
 * the matching difference line so the reason is typed once.
 */
export const ReasonsBox: React.FC<{ field: ReasonField; code: string; title: string; diffKey?: string }> = ({ field, code, title, diffKey }) => {
  const { docs, update, readOnly } = useWorkspace();
  const d = useDiffLine(diffKey ?? '');
  const value = docs.gstr9c[field] ?? '';
  const just = d?.justification?.text?.trim() ?? '';
  const canCopy = !readOnly && !!just && !value.includes(just);
  const id = `gstr9c-${field}`;
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Label htmlFor={id} className="text-sm">
          <span className="mr-1.5 text-muted-foreground">Table {code}</span>
          {title}
        </Label>
        {canCopy && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs"
            onClick={() => update('gstr9c', (doc: Gstr9cDoc) => ({ ...doc, [field]: doc[field]?.trim() ? `${doc[field].trim()}\n${just}` : just }))}
          >
            <MessageSquareText className="mr-1 h-3.5 w-3.5" /> Use the justification
          </Button>
        )}
      </div>
      <Textarea
        id={id}
        value={value}
        rows={3}
        disabled={readOnly}
        placeholder={readOnly ? '' : 'Reasons as they should read in the filed GSTR-9C'}
        onChange={(e) => {
          const v = e.target.value;
          update('gstr9c', (doc) => ({ ...doc, [field]: v }));
        }}
      />
    </div>
  );
};

/** A KPI tile for one 9C difference line (5R, 7G, 9R, 12F, 14T), with its justification status. */
export const DiffKpi: React.FC<{ lineKey: string; label: string }> = ({ lineKey, label }) => {
  const d = useDiffLine(lineKey);
  if (!d) return null;
  const taxOnly = d.hasTax;
  const mag = taxOnly ? Math.max(...HEAD_ORDER.map((h) => Math.abs(d.diff[h]))) : Math.abs(d.diff.t);
  const tone = d.open ? 'error' : mag < 0.005 ? 'ok' : 'neutral';
  return (
    <KpiTile
      label={label}
      tone={tone}
      value={fmtMoney(taxOnly ? totalTax(d.diff) : d.diff.t)}
      hint={
        <span className="mt-0.5 flex flex-wrap items-center justify-between gap-1">
          <span className="truncate">{taxOnly ? headsText(d.diff) : d.direction}</span>
          <JustifyControl lineKey={lineKey} />
        </span>
      }
    />
  );
};

/** A quiet line of reference figures shown above a manual table. */
export const RefStrip: React.FC<{ items: Array<{ label: string; value: React.ReactNode }>; className?: string }> = ({ items, className }) => (
  <div className={cn('flex flex-wrap gap-x-4 gap-y-1 rounded-md bg-muted/50 px-3 py-2 text-xs', className)}>
    {items.map((it) => (
      <span key={it.label} className="sm:whitespace-nowrap">
        <span className="text-muted-foreground">{it.label}: </span>
        <span className="font-medium tabular-nums">{it.value}</span>
      </span>
    ))}
  </div>
);
