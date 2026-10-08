// Notice types (contract §A; migrations 20261008150000_notice_types.sql and
// 20261008180000_notice_types_hidden.sql): how much each kind of notice needs a
// reply (critical, optional or none) and where its notices show: on the
// dashboard and in every list, in the lists only, or nowhere (hidden everywhere:
// the firm's choice for GSTR-3A on 7 Oct 2026). The firm asked for the reply
// need on 6 Oct 2026: "certain kinds of notices need no reply". One place for
// the words and tones, so the settings table, the list chips and the filters say
// the same thing. Notices with no form recognised are always "Reply required"
// and on the dashboard (the database decides that, in notice_facts).
import type { QueryClient } from '@tanstack/react-query';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';

export type NoticeTypeRow = Database['public']['Views']['notice_type_overview']['Row'];

export type ResponseNeed = 'critical' | 'optional' | 'none';

export interface ResponseNeedDef {
  key: ResponseNeed;
  /** The setting: "Reply required". */
  label: string;
  /** The short chip on a list row: "Critical". */
  chip: string;
  /** Red, amber, neutral (gstr9 Badge variants). */
  tone: 'destructive' | 'warning' | 'secondary';
  /** What it means, in one line (the chip's tooltip). */
  hint: string;
  /** The same in a few words (the settings' explanation line). */
  short: string;
}

export const RESPONSE_NEEDS: ResponseNeedDef[] = [
  { key: 'critical', label: 'Reply required', chip: 'Critical', tone: 'destructive',
    hint: 'a reply, appearance or payment is due by a date', short: 'due by a date' },
  { key: 'optional', label: 'Reply optional', chip: 'Optional', tone: 'warning',
    hint: 'the firm may respond (say, to a DRC-01A intimation) but need not', short: 'the firm may respond, ranked lower' },
  { key: 'none', label: 'No reply needed', chip: 'Info only', tone: 'secondary',
    hint: 'an acknowledgement, approval, own filing or payment: read it and close it', short: 'read and close, never overdue' },
];

const BY_KEY = new Map(RESPONSE_NEEDS.map((d) => [d.key, d]));

/** Where a type's notices show. */
export type TypeVisibility = 'dashboard' | 'lists' | 'hidden';

export interface VisibilityDef {
  key: TypeVisibility;
  /** The setting: "Lists only". */
  label: string;
  /** What it means, in a few words (the settings' explanation line). */
  short: string;
}

export const VISIBILITIES: VisibilityDef[] = [
  { key: 'dashboard', label: 'Dashboard and lists', short: 'counted on the dashboard and in every list' },
  { key: 'lists', label: 'Lists only', short: 'in All notices and the Work queue, not counted on the dashboard' },
  { key: 'hidden', label: 'Hidden everywhere', short: 'in no list, count, search, report or e-mail, and no reply needed' },
];

export function visibilityOf(r: Pick<NoticeTypeRow, 'hidden' | 'show_on_dashboard'>): TypeVisibility {
  if (r.hidden) return 'hidden';
  return r.show_on_dashboard === false ? 'lists' : 'dashboard';
}

export const visibilityDef = (v: TypeVisibility): VisibilityDef => VISIBILITIES.find((d) => d.key === v) ?? VISIBILITIES[0];

/** The save for a visibility: hiding also makes the type need no reply (the database insists). */
export function visibilityPatch(v: TypeVisibility): NoticeTypePatch {
  if (v === 'hidden') return { hidden: true };
  return { hidden: false, show_on_dashboard: v === 'dashboard' };
}

export function isResponseNeed(v: unknown): v is ResponseNeed {
  return typeof v === 'string' && BY_KEY.has(v as ResponseNeed);
}

/** Unknown or empty is "Reply required", as the database treats an unclassified notice. */
export function responseNeedDef(key: string | null | undefined): ResponseNeedDef {
  return BY_KEY.get((key || 'critical') as ResponseNeed) ?? RESPONSE_NEEDS[0];
}

/** Only a superadmin or a GST manager changes the settings; everyone else reads them. */
export const canManageNoticeTypes = (role: string | null | undefined): boolean =>
  role === 'superadmin' || role === 'gst_manager';

export const NOTICE_TYPES_KEY = ['notice-types'] as const;

/** One row per form rule, with its setting and how many notices it has. */
export async function loadNoticeTypes(): Promise<NoticeTypeRow[]> {
  const { data, error } = await supabase.from('notice_type_overview').select('*').order('form_code');
  if (error) throw error;
  return data ?? [];
}

export function useNoticeTypes() {
  return useQuery({ queryKey: NOTICE_TYPES_KEY, queryFn: loadNoticeTypes, staleTime: 60_000 });
}

/** Open notices with no form recognised (always "Reply required" and shown). */
export async function countUnclassifiedOpen(): Promise<number> {
  const { count, error } = await supabase.from('notice_facts').select('id', { count: 'exact', head: true })
    .is('form_code', null).eq('is_open', true);
  if (error) throw error;
  return count ?? 0;
}

export interface NoticeTypePatch {
  response_need?: ResponseNeed;
  show_on_dashboard?: boolean;
  /** Hidden everywhere (then no reply needed and off the dashboard). */
  hidden?: boolean;
}

/** Saves one type's setting (a field left out stays as it is) and stamps who changed it. */
export async function saveNoticeType(formCode: string, patch: NoticeTypePatch, actorName: string | null): Promise<Partial<NoticeTypeRow>> {
  const { data, error } = await supabase.rpc('notice_type_set', {
    p_form_code: formCode,
    p_response_need: patch.response_need,
    p_show_on_dashboard: patch.show_on_dashboard,
    p_actor_name: actorName ?? undefined,
    p_hidden: patch.hidden,
  });
  if (error) throw error;
  return (data ?? {}) as Partial<NoticeTypeRow>;
}

export const HIDDEN_FORMS_KEY = ['notice-hidden-forms'] as const;

/**
 * The form codes hidden everywhere, for the few screens that read notices outside
 * notice_facts (the bell). Empty on a database without migration 20261008180000.
 */
export async function loadHiddenForms(): Promise<Set<string>> {
  const { data, error } = await supabase.from('notice_type_settings').select('form_code').eq('hidden', true);
  if (error) return new Set();
  return new Set((data ?? []).map((r) => r.form_code));
}

/** After a type changes: the dashboard's numbers, its plan, every notice list, search and the bell follow. */
export function invalidateAfterTypeChange(qc: QueryClient) {
  ['notices-command-centre', 'notice-plan-top', 'notice-list', 'notice-list-sum', 'notice-queue', 'notice-queue-counts',
    'notice-calendar', 'notice-types-unclassified', 'notice-filter-options', 'notice-bell', 'client-profile', 'notice-workspace',
    HIDDEN_FORMS_KEY[0]].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
}
