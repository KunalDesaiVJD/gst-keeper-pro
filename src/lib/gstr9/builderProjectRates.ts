// The client's builder projects and the rate codes their units carry, for the
// rate-wise dialog's "from receipts" entry (builderReceipts.ts). Same
// classification as the Builder module (classifyUnit, the project-level RREP
// test, the client's charge inclusions).

import { supabase } from '@/integrations/supabase/client';
import { fetchBuilderSettings } from '@/lib/builderSettings';
import {
  DEFAULT_CHARGE_INCLUSIONS,
  classifyUnit,
  testRrep,
  type BuilderRateCode,
  type ChargeHead,
  type UnitType,
} from '@/utils/builderRates';
import type { BuilderProjectRate } from './builderReceipts';

interface ProjectRow {
  id: string; name: string; is_metro: boolean; carpet_area_source: string;
  manual_residential_carpet_sqm: number; manual_commercial_carpet_sqm: number;
}
interface UnitRow { id: string; project_id: string; unit_type: UnitType; carpet_area_sqm: number; base_consideration: number; status: string }
interface ChargeRow { unit_id: string; charge_head: string; amount: number; include_override: boolean | null }

export async function loadBuilderProjectRates(clientId: string): Promise<BuilderProjectRate[]> {
  const { data: proj, error } = await supabase
    .from('builder_projects')
    .select('id, name, is_metro, carpet_area_source, manual_residential_carpet_sqm, manual_commercial_carpet_sqm')
    .eq('client_id', clientId)
    .order('name');
  if (error) throw error;
  const projects = (proj ?? []) as unknown as ProjectRow[];
  if (!projects.length) return [];

  const [{ data: unt, error: uErr }, settings] = await Promise.all([
    supabase.from('builder_units').select('id, project_id, unit_type, carpet_area_sqm, base_consideration, status').in('project_id', projects.map((p) => p.id)),
    fetchBuilderSettings(clientId),
  ]);
  if (uErr) throw uErr;
  const units = ((unt ?? []) as unknown as UnitRow[]).filter((u) => u.status !== 'Cancelled');
  const charges: Record<string, ChargeRow[]> = {};
  if (units.length) {
    const { data: chg } = await supabase.from('builder_unit_charges').select('unit_id, charge_head, amount, include_override').in('unit_id', units.map((u) => u.id));
    ((chg ?? []) as unknown as ChargeRow[]).forEach((c) => { (charges[c.unit_id] ||= []).push(c); });
  }

  return projects.map((p) => {
    const own = units.filter((u) => u.project_id === p.id);
    const area = (t: UnitType) => own.filter((u) => u.unit_type === t).reduce((s, u) => s + (Number(u.carpet_area_sqm) || 0), 0);
    const isRrep = p.carpet_area_source === 'MANUAL'
      ? testRrep(p.manual_residential_carpet_sqm, p.manual_commercial_carpet_sqm).isRrep
      : testRrep(area('Residential'), area('Commercial')).isRrep;
    const count = new Map<BuilderRateCode, number>();
    own.forEach((u) => {
      const { rateCode } = classifyUnit({
        unitType: u.unit_type,
        carpetAreaSqM: Number(u.carpet_area_sqm) || 0,
        baseConsideration: Number(u.base_consideration) || 0,
        charges: (charges[u.id] ?? []).map((c) => ({ charge_head: c.charge_head as ChargeHead, amount: Number(c.amount) || 0, include_override: c.include_override })),
        isMetro: !!p.is_metro,
        isRrep,
        settings: settings || DEFAULT_CHARGE_INCLUSIONS,
      });
      count.set(rateCode, (count.get(rateCode) ?? 0) + 1);
    });
    const codes = [...count.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c);
    return { id: p.id, name: p.name, codes };
  });
}
