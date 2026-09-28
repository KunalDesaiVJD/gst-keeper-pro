import React, { useEffect, useMemo, useState } from 'react';
import { Check, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/gstr9/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { ImportChange } from '@/lib/gstr9/portalParser';
import type { FieldInfo } from '@/lib/gstr9/portalImport';
import { fmtMoney } from '../grid/money';
import { Note } from '../ui';

/**
 * Every portal import goes through this preview: Field / In the working /
 * From the portal / Change, one checkbox per figure. Figures that were typed
 * by hand start unticked and are marked "typed", so an import never replaces
 * them unless someone ticks them on purpose.
 */
export const ImportPreviewDialog: React.FC<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: React.ReactNode;
  changes: ImportChange[];
  describe: (path: string) => FieldInfo;
  /** What the portal file / pull contained. */
  coverage?: Array<{ label: string; found: boolean }>;
  readOnly?: boolean;
  /** Called with the ticked changes (possibly none — the source is still recorded). */
  onApply: (selected: ImportChange[]) => void;
}> = ({ open, onOpenChange, title, description, changes, describe, coverage, readOnly, onApply }) => {
  const [picked, setPicked] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (open) setPicked(new Set(changes.filter((c) => !c.manual).map((c) => c.path)));
  }, [open, changes]);

  const groups = useMemo(() => {
    const out: Array<{ key: string; label: string; rows: Array<ImportChange & { info: FieldInfo }> }> = [];
    changes.forEach((c) => {
      const info = describe(c.path);
      let g = out.find((x) => x.key === info.group);
      if (!g) {
        g = { key: info.group, label: info.groupLabel, rows: [] };
        out.push(g);
      }
      g.rows.push({ ...c, info });
    });
    return out;
  }, [changes, describe]);

  const typed = changes.filter((c) => c.manual).length;
  const toggle = (paths: string[], on: boolean) =>
    setPicked((prev) => {
      const next = new Set(prev);
      paths.forEach((p) => (on ? next.add(p) : next.delete(p)));
      return next;
    });
  // All, none, or some ("indeterminate": a dash, announced as partly ticked).
  const stateOf = (paths: string[]): boolean | 'indeterminate' => {
    const n = paths.filter((p) => picked.has(p)).length;
    return n === 0 ? false : n === paths.length ? true : 'indeterminate';
  };
  const allPaths = changes.map((c) => c.path);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] max-w-4xl flex-col gap-3">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription className="text-xs">{description}</DialogDescription>}
        </DialogHeader>

        {coverage && coverage.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <span className="text-muted-foreground">In this data:</span>
            {coverage.map((c) => (
              <Badge key={c.label} variant={c.found ? 'success' : 'outline'} className={cn('gap-1 text-[10px] font-medium', !c.found && 'text-muted-foreground')}>
                {c.found ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
                {c.label}
              </Badge>
            ))}
            {coverage.some((c) => !c.found) && <span className="text-muted-foreground">— missing parts are left as they are.</span>}
          </div>
        )}

        {changes.length === 0 ? (
          <Note tone="info">Nothing to change — the working already has exactly these figures. Applying only records where they came from.</Note>
        ) : (
          <>
            <div className="text-xs text-muted-foreground">
              {changes.length} figure{changes.length === 1 ? '' : 's'} differ{changes.length === 1 ? 's' : ''} from the working.
              {typed > 0 && <> {typed} of them {typed === 1 ? 'was' : 'were'} typed by hand and {typed === 1 ? 'is' : 'are'} left unticked — tick {typed === 1 ? 'it' : 'them'} only to replace the typed figure.</>}
            </div>
            <div className="min-h-0 flex-1 overflow-auto rounded-md border">
              <table className="w-full border-collapse text-xs" aria-label="Figures that would change">
                <thead className="sticky top-0 z-10 bg-muted">
                  <tr>
                    <th className="w-9 border-b px-2 py-1.5 text-left">
                      <Checkbox
                        checked={stateOf(allPaths)}
                        onCheckedChange={(v) => toggle(allPaths, v === true)}
                        aria-label="Tick every figure"
                        disabled={readOnly}
                      />
                    </th>
                    <th className="border-b px-2 py-1.5 text-left font-semibold text-muted-foreground">Figure</th>
                    <th className="w-32 border-b px-2 py-1.5 text-right font-semibold text-muted-foreground">In the working</th>
                    <th className="w-32 border-b px-2 py-1.5 text-right font-semibold text-muted-foreground">From the portal</th>
                    <th className="w-32 border-b px-2 py-1.5 text-right font-semibold text-muted-foreground">Change</th>
                  </tr>
                </thead>
                <tbody>
                  {groups.map((g) => {
                    const paths = g.rows.map((r) => r.path);
                    return (
                      <React.Fragment key={g.key}>
                        <tr className="bg-muted/50">
                          <td className="border-b px-2 py-1">
                            <Checkbox checked={stateOf(paths)} onCheckedChange={(v) => toggle(paths, v === true)} aria-label={`Tick all of ${g.label}`} disabled={readOnly} />
                          </td>
                          <td colSpan={4} className="border-b px-2 py-1 font-semibold">
                            {g.label} <span className="font-normal text-muted-foreground">· {g.rows.length}</span>
                          </td>
                        </tr>
                        {g.rows.map((r) => {
                          const delta = r.incoming - r.current;
                          return (
                            <tr key={r.path} className={cn(r.manual && 'bg-warning/5')}>
                              <td className="border-b px-2 py-1">
                                <Checkbox
                                  checked={picked.has(r.path)}
                                  onCheckedChange={(v) => toggle([r.path], v === true)}
                                  aria-label={`Apply ${g.label} — ${r.info.label}`}
                                  disabled={readOnly}
                                />
                              </td>
                              <td className="border-b px-2 py-1">
                                <span>{r.info.label}</span>
                                {r.manual && <Badge variant="warning" className="ml-2 px-1.5 py-0 text-[10px] font-medium">typed</Badge>}
                              </td>
                              <td className="border-b px-2 py-1 text-right tabular-nums">{fmtMoney(r.current)}</td>
                              <td className="border-b px-2 py-1 text-right font-medium tabular-nums">{fmtMoney(r.incoming)}</td>
                              <td className={cn('border-b px-2 py-1 text-right tabular-nums', delta < 0 ? 'text-destructive-strong' : 'text-muted-foreground')}>
                                {delta > 0 ? '+' : ''}{fmtMoney(delta)}
                              </td>
                            </tr>
                          );
                        })}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          {!readOnly && (
            <Button
              onClick={() => onApply(changes.filter((c) => picked.has(c.path)))}
              disabled={changes.length > 0 && picked.size === 0}
            >
              {changes.length === 0 ? 'Record as fetched' : `Apply ${picked.size} figure${picked.size === 1 ? '' : 's'}`}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default ImportPreviewDialog;
