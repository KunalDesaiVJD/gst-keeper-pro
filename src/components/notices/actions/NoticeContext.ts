// What the action dialogs need to know about a notice (from a plan row, a
// list row or the workspace) to title themselves and pre-fill.
export interface NoticeRef {
  id: string;
  client_id: string;
  client_name: string | null;
  reference_number: string | null;
  case_id: string | null;
  form_code: string | null;
  form_label: string | null;
  notice_type: string | null;
  description: string | null;
  financial_year: string | null;
  effective_due: string | null;
  amount_of_demand: number | null;
  matter_id: string | null;
  hearing_date?: string | null;
  hearing_note?: string | null;
  extended_due_date?: string | null;
  due_date?: string | null;
}
