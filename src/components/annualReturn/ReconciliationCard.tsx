import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { AlertTriangle, CheckCircle2, Loader2, Save } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { fetchReconciliationLines, ReconLine } from '@/lib/annualReturnReconciliation';
import { useAuth } from '@/contexts/AuthContext';

const trimmed = (v: string | undefined) => (v || '').trim();

const fmt = (v: number) => v.toLocaleString('en-IN', { maximumFractionDigits: 2 });

interface Props {
  clientId: string;
  financialYear: string;
  isNoItcBuilder: boolean;
}

/**
 * Phase 3 of the Annual Return roadmap — the reconciliation engine. Every
 * line here is computed fresh from Books Input (Phase 1) and Portal Capture
 * (Phase 2); nothing about the values is editable here, only the reason for
 * a gap. This is also where the firm's "no lock without a reason" rule
 * lives — see isFullyReconciled(), which AnnualReturnPage checks before
 * allowing a year to be locked.
 */
export const ReconciliationCard: React.FC<Props> = ({ clientId, financialYear, isNoItcBuilder }) => {
  const { user } = useAuth();
  const [lines, setLines] = useState<ReconLine[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = async (preserveDrafts = false) => {
    if (!clientId || !financialYear) { setLines([]); setLoading(false); return; }
    setLoading(true);
    try {
      const result = await fetchReconciliationLines(clientId, financialYear, isNoItcBuilder);
      setLines(result);
      if (!preserveDrafts) {
        const d: Record<string, string> = {};
        result.forEach((l) => { d[l.key] = l.reason; });
        setDrafts(d);
      }
    } catch (err) {
      toast.error('Could not compute reconciliation: ' + (err instanceof Error ? err.message : 'Unknown error'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [clientId, financialYear, isNoItcBuilder]); // eslint-disable-line react-hooks/exhaustive-deps

  // A line is "dirty" once its draft text differs from what's actually
  // saved (l.reason) — this drives both the batch-save button's count and
  // which rows get included in the next save.
  const dirtyLines = lines.filter((l) => l.reasonRequired && !l.matched && trimmed(drafts[l.key]) !== trimmed(l.reason) && trimmed(drafts[l.key]).length > 0);

  const saveDirtyReasons = async () => {
    if (dirtyLines.length === 0) return;
    setSaving(true);
    try {
      const now = new Date().toISOString();
      const payload = dirtyLines.map((l) => ({
        client_id: clientId, financial_year: financialYear, line_key: l.key,
        reason: trimmed(drafts[l.key]), entered_by: user?.id || null, updated_at: now,
      }));
      const { error } = await supabase.from('reconciliation_reasons').upsert(payload, { onConflict: 'client_id,financial_year,line_key' });
      if (error) throw error;
      toast.success(`${payload.length} reason${payload.length === 1 ? '' : 's'} saved.`);
      setDrafts((d) => {
        const next = { ...d };
        payload.forEach((p) => { next[p.line_key] = p.reason; });
        return next;
      });
      await load(true);
    } catch (err) {
      toast.error('Save failed: ' + (err instanceof Error ? err.message : 'Unknown error'));
    } finally {
      setSaving(false);
    }
  };

  const openCount = lines.filter((l) => l.reasonRequired && !l.reason.trim()).length;

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" /> Loading...
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {openCount > 0 ? (
        <div className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm bg-destructive/5 border-destructive/20 text-destructive">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {openCount} of {lines.length} line{lines.length === 1 ? '' : 's'} carr{openCount === 1 ? 'ies' : 'y'} a difference with no reason recorded yet — this year can&apos;t be locked until they're explained.
        </div>
      ) : (
        <div className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm bg-success/5 border-success/20 text-success">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          Every difference is either matched or has a reason on file.
        </div>
      )}

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-3 flex-wrap">
          <div>
            <CardTitle className="text-lg">Books vs Portal</CardTitle>
            <CardDescription>Computed live from Books Input and Portal Capture — nothing here is retyped.</CardDescription>
          </div>
          <Button size="sm" variant={dirtyLines.length > 0 ? 'default' : 'outline'} disabled={saving || dirtyLines.length === 0} onClick={saveDirtyReasons}>
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Save className="h-3.5 w-3.5 mr-1.5" />}
            Save reasons{dirtyLines.length > 0 ? ` (${dirtyLines.length})` : ''}
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Particulars</TableHead>
                <TableHead className="text-right">Books</TableHead>
                <TableHead className="text-right">Portal</TableHead>
                <TableHead className="text-right">Difference</TableHead>
                <TableHead>Reason</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lines.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-sm text-muted-foreground py-8">
                    No reconciliation lines available for this client/year.
                  </TableCell>
                </TableRow>
              ) : lines.map((l) => (
                <TableRow key={l.key}>
                  <TableCell className="font-medium align-top">
                    {l.label}
                    <div className="text-xs text-muted-foreground font-normal mt-0.5">{l.booksLabel} vs {l.portalLabel}</div>
                  </TableCell>
                  <TableCell className="text-right tabular-nums align-top">{fmt(l.books ?? 0)}</TableCell>
                  <TableCell className="text-right tabular-nums align-top">{fmt(l.portal)}</TableCell>
                  <TableCell className={`text-right tabular-nums align-top font-semibold ${l.matched ? 'text-success' : 'text-destructive'}`}>
                    {fmt(l.difference)}
                  </TableCell>
                  <TableCell className="min-w-[260px]">
                    {l.matched ? (
                      <span className="text-xs text-muted-foreground">Matched — no reason needed.</span>
                    ) : !l.reasonRequired ? (
                      <span className="text-xs text-muted-foreground">Not required — no-ITC scheme client.</span>
                    ) : (
                      <Textarea
                        value={drafts[l.key] ?? ''}
                        onChange={(e) => setDrafts((d) => ({ ...d, [l.key]: e.target.value }))}
                        placeholder="Why does this differ?"
                        aria-label={`Reason for ${l.label}`}
                        rows={3}
                        className="text-sm"
                      />
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
};

export default ReconciliationCard;
