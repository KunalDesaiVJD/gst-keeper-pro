// Reads the client's other GSTR-1s, for amendments counted at their
// difference (amendments.ts, which is pure). The filed return pulled from
// the portal is taken before the imported one of the same month.
import { supabase } from '@/integrations/supabase/client';
import { hasAmendments, type Gstr1History } from './amendments';

type Gj = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Nothing amended: an empty history, and no read. */
export async function loadGstr1History(clientId: string, raw: unknown): Promise<Gstr1History> {
  const g = raw && typeof raw === 'object' ? (raw as Gj) : null;
  if (!clientId || !hasAmendments(g)) return {};
  const [imported, filed] = await Promise.all([
    supabase.from('gstr1_data').select('period_month, raw_json').eq('client_id', clientId),
    supabase.from('gst_filed_returns').select('period_month, full_json').eq('client_id', clientId).eq('return_type', 'GSTR1'),
  ]);
  const months: Gstr1History = {};
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
  return months;
}
