import React, { useEffect, useRef, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { RefreshCw, Upload, FileSpreadsheet } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { parseGstr2aFile } from '@/utils/parseGstr2a';

interface Gstr2aImportCardProps {
  clientId: string;
  clientName: string;
  clientGstin: string;
  month: string; // MM/YYYY
  readOnly?: boolean;
}

// Same base64 <-> File round-trip the GSTR-2B "Pull from portal" flow already
// uses (Import2BTab.tsx) — the extension hands back a data: URL, this turns
// it back into a File the existing parser can read.
const dataUrlToFile = (dataUrl: string, name: string): File => {
  const [meta, b64] = String(dataUrl).split(',');
  const mime = (meta.match(/data:([^;]+)/) || [])[1] || 'application/octet-stream';
  const bin = atob(b64 || '');
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new File([bytes], name, { type: mime });
};

/**
 * GSTR-2A import — informational only, no reconciliation workflow (unlike
 * GSTR-2B's Import 2B tab). Feeds the 3 GSTR-2A reports on the Reports Hub
 * (Rate Wise, Supplier Wise, P.Y invoice showing in C.Y) via
 * gstr2a_import_docs, delete-then-insert per client+period so a re-pull
 * always reflects the portal's latest state.
 */
export const Gstr2aImportCard: React.FC<Gstr2aImportCardProps> = ({ clientId, clientName, clientGstin, month, readOnly }) => {
  const [extReady, setExtReady] = useState(false);
  const [count, setCount] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const refreshCount = async () => {
    if (!clientId || !month) { setCount(null); return; }
    const { count: c } = await supabase
      .from('gstr2a_import_docs')
      .select('id', { count: 'exact', head: true })
      .eq('client_id', clientId).eq('period_month', month);
    setCount(c ?? 0);
  };

  useEffect(() => { refreshCount(); }, [clientId, month]);

  const importFile = async (file: File) => {
    setBusy(true);
    try {
      const result = await parseGstr2aFile(file);
      const fileGstin = (result.header.gstin || '').toUpperCase().trim();
      const clientGstinNorm = (clientGstin || '').toUpperCase().trim();
      if (fileGstin && clientGstinNorm && fileGstin !== clientGstinNorm) {
        toast.error(`File GSTIN (${fileGstin}) doesn't match ${clientName} (${clientGstinNorm}) — not imported.`);
        return;
      }
      result.warnings.forEach((w) => toast.warning(w));
      const rows = result.records.map((r) => ({
        client_id: clientId,
        period_month: month,
        bucket: 'available',
        supplier_gstin: r.supplierGstin,
        supplier_name: r.supplierName,
        supplier_invoice_number: r.invoiceNumber,
        invoice_type: r.invoiceType,
        date: r.invoiceDate,
        invoice_value: r.invoiceValue,
        place_of_supply: r.placeOfSupply,
        taxable_value: r.taxableValue,
        input_igst: r.inputIgst,
        input_cgst: r.inputCgst,
        input_sgst: r.inputSgst,
        cess: r.cess,
        reverse_charge: r.reverseCharge,
        gstr1_filing_date: r.gstr1FilingDate,
        gstr1_period: r.gstr1Period,
        source: r.source,
        irn: r.irn,
      }));
      const { error: delErr } = await supabase.from('gstr2a_import_docs').delete().eq('client_id', clientId).eq('period_month', month);
      if (delErr) throw delErr;
      if (rows.length) {
        const { error: insErr } = await supabase.from('gstr2a_import_docs').insert(rows);
        if (insErr) throw insErr;
      }
      toast.success(`GSTR-2A imported — ${rows.length} document(s).`);
      await refreshCount();
    } catch (err: any) {
      toast.error('GSTR-2A import failed: ' + (err?.message || 'unknown error'));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    window.postMessage({ __gstkAppReady: true }, '*');
    const onMsg = (e: MessageEvent) => {
      const d: any = e.data;
      if (!d || typeof d !== 'object') return;
      if (d.__gstkExtensionReady) setExtReady(true);
      if (d.__gstkPull2AResult) {
        const r = d.__gstkPull2AResult;
        if (!r.ok) { toast.error('Portal 2A pull: ' + (r.error || 'failed')); setBusy(false); return; }
        if (r.clientId !== clientId || r.period !== month) {
          toast.warning(`Pulled GSTR-2A is for a different client/month (${r.period}) — open that client & month to import it.`);
          setBusy(false);
          return;
        }
        importFile(dataUrlToFile(r.fileB64, r.fileName || 'GSTR2A.xlsx'));
      }
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, month]);

  const pullFromPortal = () => {
    if (!extReady) { toast.error('Install/enable the GST Keeper browser extension, then reload this page.'); return; }
    setBusy(true);
    window.postMessage({ __gstkPull2A: { clientId, period_month: month } }, '*');
    toast.info("Opening the portal in a new tab — type the CAPTCHA there; GSTR-2A will import here automatically when it finishes.");
  };

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) importFile(file);
    e.target.value = '';
  };

  if (!clientId || !month) return null;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-2 flex-wrap">
          <div>
            <CardTitle className="text-base">GSTR-2A Import</CardTitle>
            <CardDescription>
              Powers the GSTR-2A reports (Rate Wise, Supplier Wise, P.Y invoice showing in C.Y) — informational only, separate from Import 2B's reconciliation ledger.
            </CardDescription>
          </div>
          {!readOnly && (
            <div className="flex gap-2 flex-wrap">
              <Button
                variant="outline"
                size="sm"
                onClick={pullFromPortal}
                disabled={busy}
                className={extReady ? '' : 'text-muted-foreground'}
                title={extReady ? `Pull ${clientName}'s GSTR-2A from the portal via the browser extension` : 'GST Keeper extension not detected yet — install/enable it and reload this page'}
              >
                <RefreshCw className="h-3.5 w-3.5 mr-2" />
                Pull from portal
              </Button>
              <Button variant="ghost" size="sm" onClick={() => fileInputRef.current?.click()} disabled={busy}>
                <Upload className="h-3.5 w-3.5 mr-1" />
                Import file
              </Button>
              <input ref={fileInputRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={onFileChange} />
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground flex items-center gap-2">
          <FileSpreadsheet className="h-4 w-4" />
          {count === null ? 'Loading…' : count === 0 ? 'No GSTR-2A imported for this period yet.' : `${count} document(s) imported for this period.`}
        </p>
      </CardContent>
    </Card>
  );
};

export default Gstr2aImportCard;
