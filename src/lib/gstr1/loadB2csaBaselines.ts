// Reads what the months a GSTR-1's Table 10 entries amend last reported
// (buildB2csaBaselines in b2csaBaseline.ts, which is pure).
import { supabase } from '@/integrations/supabase/client';
import { buildB2csaBaselines, type B2csaBaselines } from './b2csaBaseline';

type Gj = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const list = (v: unknown): Gj[] => (Array.isArray(v) ? v : []);

/**
 * Loads the client's other GSTR-1s (the filed return pulled from the portal
 * first, else the imported one) and builds the baselines for `raw`.
 * Nothing to amend: an empty map, and no read.
 */
export async function loadB2csaBaselines(clientId: string, raw: unknown, isRestated: (a: Gj) => boolean): Promise<B2csaBaselines> {
  const g = raw && typeof raw === 'object' ? (raw as Gj) : null;
  if (!clientId || !g || !list(g.b2csa).some(isRestated)) return {};
  const SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const [imported, filed] = await Promise.all([
    supabase.from('gstr1_data').select('period_month, raw_json').eq('client_id', clientId),
    supabase.from('gst_filed_returns').select('period_month, full_json').eq('client_id', clientId).eq('return_type', 'GSTR1'),
  ]);
  const months: Record<string, Gj> = {};
  ((imported.data as { period_month: string; raw_json: Gj | null }[] | null) || []).forEach((r) => {
    const [mon, yy] = String(r.period_month || '').split('-');
    const mi = SHORT.indexOf(mon);
    if (mi < 0 || !yy || !r.raw_json) return;
    months[`${String(mi + 1).padStart(2, '0')}20${yy}`] = r.raw_json;
  });
  ((filed.data as { period_month: string; full_json: Gj | null }[] | null) || []).forEach((r) => {
    const [mm, yyyy] = String(r.period_month || '').split('/');
    if (r.full_json && Object.keys(r.full_json).length && mm && yyyy) months[`${mm}${yyyy}`] = r.full_json;
  });
  return buildB2csaBaselines(g, months, isRestated);
}
