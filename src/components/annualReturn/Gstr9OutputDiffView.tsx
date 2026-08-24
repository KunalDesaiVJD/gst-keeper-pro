import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';

const TOLERANCE = 10;
const CATEGORIES = ['b2c', 'b2b', 'sez_with', 'sez_without', 'zero_rated', 'deemed_export', 'credit_note'] as const;
const CATEGORY_LABEL: Record<string, string> = {
  b2c: 'B2C', b2b: 'B2B', sez_with: 'SEZ with payment', sez_without: 'SEZ w/o payment',
  zero_rated: 'Zero rated', deemed_export: 'Deemed export', credit_note: 'Credit note',
};

interface CatVal { taxable: number; igst: number; cgst: number; sgst: number; }
const zero = (): CatVal => ({ taxable: 0, igst: 0, cgst: 0, sgst: 0 });
const total = (v: CatVal) => v.igst + v.cgst + v.sgst;
const fmt = (v: number) => v.toLocaleString('en-IN', { maximumFractionDigits: 2 });

interface Props { clientId: string; financialYear: string; }

/**
 * GSTR 9-OUTPUT — books (column A) vs auto-populated (column B), side by
 * side, with the difference the sheet itself shows. No reason capture here
 * yet (that's a reconciliation_reasons expansion, R7) — this view is the
 * diff surface, not the explanation surface.
 */
export const Gstr9OutputDiffView: React.FC<Props> = ({ clientId, financialYear }) => {
  const [books, setBooks] = useState<Record<string, CatVal>>({});
  const [portal, setPortal] = useState<Record<string, CatVal>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!clientId || !financialYear) { setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    Promise.all([
      supabase.from('gstr9_output_lines').select('category, taxable_value, igst, cgst, sgst').eq('client_id', clientId).eq('financial_year', financialYear),
      supabase.from('portal_gstr1_category_figures').select('category, taxable_value, igst, cgst, sgst').eq('client_id', clientId).eq('financial_year', financialYear),
    ]).then(([booksRes, portalRes]) => {
      if (cancelled) return;
      if (booksRes.error) throw booksRes.error;
      if (portalRes.error) throw portalRes.error;
      const b: Record<string, CatVal> = {}; const p: Record<string, CatVal> = {};
      CATEGORIES.forEach((c) => { b[c] = zero(); p[c] = zero(); });
      (booksRes.data || []).forEach((r: { category: string; taxable_value: number; igst: number; cgst: number; sgst: number }) => { b[r.category] = { taxable: r.taxable_value, igst: r.igst, cgst: r.cgst, sgst: r.sgst }; });
      (portalRes.data || []).forEach((r: { category: string; taxable_value: number; igst: number; cgst: number; sgst: number }) => { p[r.category] = { taxable: r.taxable_value, igst: r.igst, cgst: r.cgst, sgst: r.sgst }; });
      setBooks(b); setPortal(p);
    }).catch((err) => toast.error('Could not load GSTR 9-Output diff: ' + (err instanceof Error ? err.message : 'Unknown error')))
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [clientId, financialYear]);

  if (loading) return <Card><CardContent className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></CardContent></Card>;

  const totalBooks = CATEGORIES.reduce((a, c) => a + total(books[c] || zero()), 0);
  const totalPortal = CATEGORIES.reduce((a, c) => a + total(portal[c] || zero()), 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">GSTR 9-OUTPUT — Books vs Portal</CardTitle>
        <CardDescription>Difference between column A (books) and column B (auto-populated).</CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Category</TableHead>
              <TableHead className="text-right">Books</TableHead>
              <TableHead className="text-right">Auto-populated</TableHead>
              <TableHead className="text-right">Diff</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {CATEGORIES.map((c) => {
              const b = total(books[c] || zero());
              const p = total(portal[c] || zero());
              const diff = b - p;
              const matched = Math.abs(diff) <= TOLERANCE;
              return (
                <TableRow key={c}>
                  <TableCell className="font-medium">{CATEGORY_LABEL[c]}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmt(b)}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmt(p)}</TableCell>
                  <TableCell className={`text-right tabular-nums font-semibold ${matched ? 'text-success' : 'text-destructive'}`}>{fmt(diff)}</TableCell>
                </TableRow>
              );
            })}
            <TableRow className="bg-primary/5 font-semibold">
              <TableCell>Total</TableCell>
              <TableCell className="text-right tabular-nums">{fmt(totalBooks)}</TableCell>
              <TableCell className="text-right tabular-nums">{fmt(totalPortal)}</TableCell>
              <TableCell className={`text-right tabular-nums ${Math.abs(totalBooks - totalPortal) <= TOLERANCE ? 'text-success' : 'text-destructive'}`}>{fmt(totalBooks - totalPortal)}</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
};

export default Gstr9OutputDiffView;
