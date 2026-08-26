import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Loader2, Save } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';

const TAX_HEADS = ['igst', 'cgst', 'sgst', 'cess'] as const;
const TAX_HEAD_LABEL: Record<string, string> = { igst: 'Integrated Tax', cgst: 'Central Tax', sgst: 'State/UT Tax', cess: 'Cess' };
const FIELDS = ['payable', 'paid_cash', 'paid_itc', 'interest', 'late_fee', 'penalty'] as const;
const FIELD_LABEL: Record<string, string> = { payable: 'Payable', paid_cash: 'Paid (Cash)', paid_itc: 'Paid (ITC)', interest: 'Interest', late_fee: 'Late Fee', penalty: 'Penalty' };

interface Row { tax_head: string; payable: string; paid_cash: string; paid_itc: string; interest: string; late_fee: string; penalty: string; }
const num = (v: string) => (v === '' ? 0 : Number(v));
const fmt = (v: number) => v.toLocaleString('en-IN', { maximumFractionDigits: 2 });

interface Props { clientId: string; financialYear: string; }

/** GSTR-9 Table 9 / Annexure 1 / Notice Format — tax actually paid, from the filed challans. No other source. */
export const PortalTaxPaymentCard: React.FC<Props> = ({ clientId, financialYear }) => {
  const [rows, setRows] = useState<Record<string, Row>>({});
  const [dirty, setDirty] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    if (!clientId || !financialYear) { setRows({}); setLoading(false); return; }
    setLoading(true);
    const { data, error } = await supabase.from('portal_tax_payment_entries').select('*').eq('client_id', clientId).eq('financial_year', financialYear);
    if (error) { toast.error('Could not load tax payment entries: ' + error.message); setLoading(false); return; }
    const next: Record<string, Row> = {};
    TAX_HEADS.forEach((h) => { next[h] = { tax_head: h, payable: '0', paid_cash: '0', paid_itc: '0', interest: '0', late_fee: '0', penalty: '0' }; });
    (data || []).forEach((r: Record<string, unknown>) => {
      next[r.tax_head as string] = {
        tax_head: r.tax_head as string,
        payable: String(r.payable), paid_cash: String(r.paid_cash), paid_itc: String(r.paid_itc),
        interest: String(r.interest), late_fee: String(r.late_fee), penalty: String(r.penalty),
      };
    });
    setRows(next);
    setDirty({});
    setLoading(false);
  };

  useEffect(() => { load(); }, [clientId, financialYear]); // eslint-disable-line react-hooks/exhaustive-deps

  const update = (head: string, field: keyof Row, value: string) => {
    setRows((prev) => ({ ...prev, [head]: { ...prev[head], [field]: value } }));
    setDirty((prev) => ({ ...prev, [head]: true }));
  };

  const dirtyHeads = TAX_HEADS.filter((h) => dirty[h]);

  const saveAll = async () => {
    if (dirtyHeads.length === 0) return;
    setSaving(true);
    try {
      const payload = dirtyHeads.map((h) => {
        const r = rows[h];
        return { client_id: clientId, financial_year: financialYear, tax_head: h, payable: num(r.payable), paid_cash: num(r.paid_cash), paid_itc: num(r.paid_itc), interest: num(r.interest), late_fee: num(r.late_fee), penalty: num(r.penalty), updated_at: new Date().toISOString() };
      });
      const { error } = await supabase.from('portal_tax_payment_entries').upsert(payload, { onConflict: 'client_id,financial_year,tax_head' });
      if (error) throw error;
      toast.success(`${dirtyHeads.length} row${dirtyHeads.length === 1 ? '' : 's'} saved.`);
      setDirty((prev) => {
        const next = { ...prev };
        dirtyHeads.forEach((h) => { next[h] = false; });
        return next;
      });
    } catch (err) {
      toast.error('Save failed: ' + (err instanceof Error ? err.message : 'Unknown error'));
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <Card><CardContent className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></CardContent></Card>;

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
        <div>
          <CardTitle className="text-lg">Tax Paid</CardTitle>
          <CardDescription>From the filed challans — no other source produces this. Feeds GSTR-9 Table 9, Annexure 1, and Notice Format.</CardDescription>
        </div>
        <Button size="sm" disabled={dirtyHeads.length === 0 || saving} onClick={saveAll}>
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Save className="h-3.5 w-3.5 mr-1.5" />}
          Save changes{dirtyHeads.length > 0 ? ` (${dirtyHeads.length})` : ''}
        </Button>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Tax Head</TableHead>
              {FIELDS.map((f) => <TableHead key={f} className="text-right">{FIELD_LABEL[f]}</TableHead>)}
            </TableRow>
          </TableHeader>
          <TableBody>
            {TAX_HEADS.map((h) => {
              const r = rows[h] || { tax_head: h, payable: '0', paid_cash: '0', paid_itc: '0', interest: '0', late_fee: '0', penalty: '0' };
              return (
                <TableRow key={h}>
                  <TableCell className="font-medium">{TAX_HEAD_LABEL[h]}</TableCell>
                  {FIELDS.map((f) => (
                    <TableCell key={f}><Input type="number" className="text-right h-8 w-28" value={r[f]} disabled={saving} onChange={(e) => update(h, f, e.target.value)} /></TableCell>
                  ))}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
};

export default PortalTaxPaymentCard;
