import React from 'react';
import { MONTH_LABEL } from '@/lib/gstr9/engine';
import type { DiffLine } from '@/lib/gstr9/engine';
import { FY_MONTHS, type MonthKey } from '@/lib/gstr9/types';
import { useWorkspace } from '../WorkspaceContext';
import { JustifyControl, Note } from '../ui';

const GROUPS: Array<{ prefix: string; label: string }> = [
  { prefix: 'dto.', label: 'Output tax' },
  { prefix: 'dti.', label: 'Input tax' },
];

/** "dto.apr" → "Apr"; any other line keeps its own label. */
const shortLabel = (d: DiffLine): string => {
  const tail = d.key.slice(d.key.indexOf('.') + 1);
  return (FY_MONTHS as readonly string[]).includes(tail) ? MONTH_LABEL[tail as MonthKey] : d.label;
};

/**
 * The step's open differences in one line — the same lines and reason
 * editors as OpenDifferences, grouped Output / Input with month names
 * instead of twelve near-identical "… books vs GSTR-3B" labels, so the
 * month table stays in the first screen. Each chip's control carries the
 * full line label for screen readers and as its tooltip.
 */
const DutiesOpenStrip: React.FC = () => {
  const { workings } = useWorkspace();
  const open = workings.diffs.filter((d) => d.step === 'duties' && d.open);
  if (!open.length) return null;
  const groups = [
    ...GROUPS.map((g) => ({ ...g, items: open.filter((d) => d.key.startsWith(g.prefix)) })),
    { prefix: '', label: 'Other', items: open.filter((d) => !GROUPS.some((g) => d.key.startsWith(g.prefix))) },
  ].filter((g) => g.items.length);
  return (
    <Note tone="warn" className="py-1">
      <span className="font-medium">{open.length === 1 ? '1 difference needs a reason' : `${open.length} differences need a reason`}</span>
      {groups.map((g) => (
        <span key={g.label} className="ml-3 inline-flex flex-wrap items-center gap-1 align-middle">
          <span className="text-muted-foreground">{g.label}:</span>
          {g.items.map((d) => (
            <span key={d.key} className="inline-flex items-center gap-0.5 rounded border bg-card py-px pl-1.5 pr-0.5" title={d.label}>
              {shortLabel(d)}
              <JustifyControl lineKey={d.key} compact />
            </span>
          ))}
        </span>
      ))}
    </Note>
  );
};

export default DutiesOpenStrip;
