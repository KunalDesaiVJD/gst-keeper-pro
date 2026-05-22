import {
  ReturnType,
  RegistrationType,
  FilingStatusType,
  RETURN_TYPES_BY_REGISTRATION,
  QUARTERLY_RETURN_TYPES,
  isQuarterEndMonth,
} from '@/types';
import { SchemeHistoryEntry } from '@/utils/schemeResolver';

// Single source of truth for turning the clients master + filing_status rows
// into the canonical per-client filing list for a given return tab/month.
// Both the Filing Status page and the Dashboard derive their numbers from
// this so their "pending" counts always tally.

export interface FilingClient {
  id: string;
  name?: string;
  gstin?: string;
  mobile?: string | null;
  email?: string | null;
  assigned_accountant?: string | null;
  registration_type: string;
  selected_returns: string[] | null;
  registration_date: string;
  cancellation_date?: string | null;
  target_date_group1?: number | null;
  target_date_group2?: number | null;
}

export interface GeneratedFilingRecord {
  id: string;
  client_id: string;
  return_type: string;
  period_month: string;
  status: FilingStatusType;
  target_date: number | null;
  filed_date: string | null;
  remarks: string | null;
  is_locked: boolean | null;
  updated_by: string | null;
  updated_at: string | null;
  arn: string | null;
  return_pdf_url: string | null;
  clientName?: string;
  clientEmail?: string;
  contactNumber?: string;
  accountantName?: string;
  filingFrequency?: string;
  updatedByName?: string;
  updatedByRole?: string;
}

export function isClientVisibleForMonth(client: FilingClient, periodMonth: string): boolean {
  const [monthStr, yearStr] = periodMonth.split('/');
  const periodDate = new Date(parseInt(yearStr), parseInt(monthStr) - 1, 1);
  const regDate = new Date(client.registration_date);
  const regMonth = new Date(regDate.getFullYear(), regDate.getMonth(), 1);
  if (periodDate < regMonth) return false;
  if (client.cancellation_date) {
    const cancelDate = new Date(client.cancellation_date);
    const cancelMonth = new Date(cancelDate.getFullYear(), cancelDate.getMonth(), 1);
    if (periodDate > cancelMonth) return false;
  }
  return true;
}

export function getEffectiveScheme(
  clientId: string,
  periodMonth: string,
  currentScheme: string,
  schemeHistoryMap: Record<string, SchemeHistoryEntry[]>
): string {
  const history = schemeHistoryMap[clientId];
  if (!history || history.length === 0) return currentScheme;

  const [mm, yyyy] = periodMonth.split('/');
  if (!mm || !yyyy) return currentScheme;
  const periodDate = new Date(parseInt(yyyy), parseInt(mm) - 1, 1);

  let effectiveScheme = history[0].old_scheme;
  for (const entry of history) {
    const effectiveDate = new Date(entry.effective_from_date);
    const effectiveMonthStart = new Date(effectiveDate.getFullYear(), effectiveDate.getMonth(), 1);
    if (periodDate >= effectiveMonthStart) {
      effectiveScheme = entry.new_scheme;
    } else {
      break;
    }
  }
  return effectiveScheme;
}

export function isQuarterlyReturnVisibleForMonth(returnType: ReturnType, periodMonth: string): boolean {
  if (!QUARTERLY_RETURN_TYPES.includes(returnType)) return true;
  const [monthStr] = periodMonth.split('/');
  return isQuarterEndMonth(parseInt(monthStr));
}

export function generateFilingRecords(params: {
  displayReturnType: ReturnType;
  clients: FilingClient[];
  filingRecords: GeneratedFilingRecord[];
  schemeHistoryMap: Record<string, SchemeHistoryEntry[]>;
  selectedMonth: string;
  targetDateLookup?: Record<string, number>;
}): GeneratedFilingRecord[] {
  const {
    displayReturnType: returnType,
    clients,
    filingRecords,
    schemeHistoryMap,
    selectedMonth,
    targetDateLookup = {},
  } = params;

  const records: GeneratedFilingRecord[] = [];

  if (!isQuarterlyReturnVisibleForMonth(returnType, selectedMonth)) {
    return [];
  }

  // GSTR-1 tab also covers GSTR-1 (IFF); GSTR-3B tab also covers GSTR-3B (Q)
  let returnTypesToCheck: ReturnType[];
  if (returnType === 'GSTR-1') {
    returnTypesToCheck = ['GSTR-1', 'GSTR-1 (IFF)'];
  } else if (returnType === 'GSTR-3B') {
    returnTypesToCheck = ['GSTR-3B', 'GSTR-3B (Q)'];
  } else {
    returnTypesToCheck = [returnType];
  }

  const [monthStr] = selectedMonth.split('/');
  const currentMonthNum = parseInt(monthStr);
  const isQuarterEnd = isQuarterEndMonth(currentMonthNum);

  clients.forEach(client => {
    if (!isClientVisibleForMonth(client, selectedMonth)) return;

    const effectiveScheme = getEffectiveScheme(client.id, selectedMonth, client.registration_type, schemeHistoryMap);
    const effectiveReturns = RETURN_TYPES_BY_REGISTRATION[effectiveScheme as RegistrationType] || [];
    const hasSchemeHistory = (schemeHistoryMap[client.id]?.length ?? 0) > 0;
    const selectedReturns = hasSchemeHistory ? effectiveReturns : (client.selected_returns || []);
    const isQuarterlyClient = effectiveScheme === 'IFF' || effectiveScheme === 'Composition';

    for (const rt of returnTypesToCheck) {
      if (selectedReturns.includes(rt)) {
        if (rt === 'GSTR-3B (Q)' && (!isQuarterEnd || !isQuarterlyClient)) continue;
        if (rt === 'GSTR-3B' && isQuarterlyClient) continue;

        const existingRecord = filingRecords.find(
          f => f.client_id === client.id && f.return_type === rt
        );

        let filingFrequency: string;
        if (effectiveScheme === 'IFF' && (rt === 'GSTR-1 (IFF)' || returnType === 'GSTR-1')) {
          filingFrequency = 'IFF';
        } else if (
          QUARTERLY_RETURN_TYPES.includes(rt) ||
          effectiveScheme === 'Composition' ||
          (effectiveScheme === 'IFF' && rt === 'GSTR-3B (Q)')
        ) {
          filingFrequency = 'Quarterly';
        } else {
          filingFrequency = 'Monthly';
        }

        if (existingRecord) {
          const lookupKey = `${client.id}__${rt}`;
          const authoritativeTarget = targetDateLookup[lookupKey];
          records.push({
            ...existingRecord,
            target_date: authoritativeTarget || existingRecord.target_date,
            clientName: client.name,
            clientEmail: client.email || '-',
            contactNumber: client.mobile || '-',
            accountantName: client.assigned_accountant || '-',
            filingFrequency,
          });
        } else {
          const lookupKey = `${client.id}__${rt}`;
          records.push({
            id: `temp-${client.id}-${rt}`,
            client_id: client.id,
            return_type: rt,
            period_month: selectedMonth,
            status: 'Data Pending',
            target_date: targetDateLookup[lookupKey] ||
              (rt === 'GSTR-1' || rt === 'GSTR-1 (IFF)' ? 11 : rt === 'GSTR-3B' || rt === 'GSTR-3B (Q)' ? 20 : 25),
            filed_date: null,
            remarks: null,
            is_locked: false,
            updated_by: null,
            updated_at: null,
            arn: null,
            return_pdf_url: null,
            clientName: client.name,
            clientEmail: client.email || '-',
            contactNumber: client.mobile || '-',
            accountantName: client.assigned_accountant || '-',
            filingFrequency,
          });
        }
        break;
      }
    }
  });

  return records;
}

// All return tabs shown on the Filing Status page / Dashboard breakdown.
export const DISPLAY_RETURN_TYPES: ReturnType[] = ['GSTR-1', 'GSTR-3B', 'ITC-04', 'GSTR-6', 'GSTR-7', 'CMP-08'];
