import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { AlertTriangle, Download, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { downloadGstr9cExport } from '@/utils/gstr9cJsonExport';

interface Props { clientId: string; financialYear: string; }

/**
 * Roadmap step 9 (portal-push path 1b) — a best-effort GSTR-9C JSON
 * export, mirroring the offline utility's own sheet/row layout. This is
 * NOT verified against the utility's actual import schema (no sample file
 * or macro source was available to confirm it), so it's presented as a
 * cross-check export rather than an upload-ready file — the warning below
 * is load-bearing, not decoration.
 */
export const Gstr9cJsonExportCard: React.FC<Props> = ({ clientId, financialYear }) => {
  const [exporting, setExporting] = useState(false);

  const handleExport = async () => {
    setExporting(true);
    try {
      await downloadGstr9cExport(clientId, financialYear);
    } catch (err) {
      toast.error('Export failed: ' + (err instanceof Error ? err.message : 'Unknown error'));
    } finally {
      setExporting(false);
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3 flex-wrap">
        <div>
          <CardTitle className="text-lg">GSTR-9C Data Export</CardTitle>
          <CardDescription>Every table above, in one JSON file matching the offline utility's sheet layout.</CardDescription>
        </div>
        <Button size="sm" variant="outline" disabled={exporting} onClick={handleExport} className="gap-2">
          {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
          Export JSON
        </Button>
      </CardHeader>
      <CardContent>
        <div className="flex items-start gap-2 rounded-md border px-3 py-2.5 text-sm bg-destructive/5 border-destructive/20 text-destructive">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          <span>
            <b>Unverified format.</b> This mirrors the offline utility's own sheet and row layout, but its actual JSON
            import schema hasn't been confirmed — no sample export or macro source was available to check against.
            Use this to cross-check figures or as a starting point, not to file directly. Try importing it into the
            real utility and see what happens before relying on it.
          </span>
        </div>
      </CardContent>
    </Card>
  );
};

export default Gstr9cJsonExportCard;
