import { useEffect, useState } from 'react';
import { fetchAllRows } from '@/lib/fetchAllRows';
import { supabase } from '@/integrations/supabase/client';

export interface NoticeSetRow {
  id: string;
  client_id: string;
  notice_type: string | null;
  description: string | null;
  staff_status: string | null;
  priority: string | null;
  issue_date: string | null;
  due_date: string | null;
  extended_due_date: string | null;
  reply_date: string | null;
  first_seen_at: string | null;
  pulled_at: string;
  case_id: string | null;
  reference_number: string | null;
  assign_to: string | null;
  assign_to_user_id: string | null;
  amount_of_demand: number | null;
  hearing_date: string | null;
}

export interface StatusRow { client_id?: string; arn: string | null; status: string | null; }

const NOTICE_SELECT =
  'id, client_id, notice_type, description, staff_status, priority, issue_date, due_date, ' +
  'extended_due_date, reply_date, first_seen_at, pulled_at, case_id, reference_number, ' +
  'assign_to, assign_to_user_id, amount_of_demand, hearing_date';

export function useNoticeSet() {
  const [rows, setRows] = useState<NoticeSetRow[]>([]);
  const [refundRows, setRefundRows] = useState<StatusRow[]>([]);
  const [drc03Rows, setDrc03Rows] = useState<StatusRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [noticesData, refundRes, drc03Res] = await Promise.all([
          fetchAllRows<NoticeSetRow>(
            'gst_notices',
            NOTICE_SELECT,
            (q) => q.eq('source', 'notices').is('deleted_at', null).order('id'),
          ),
          supabase.from('gst_refund_applications').select('client_id, arn, status').is('deleted_at', null),
          supabase.from('gst_drc03_filings').select('client_id, arn, status').is('deleted_at', null),
        ]);
        if (!cancelled) {
          setRows(noticesData);
          setRefundRows((refundRes.data || []) as StatusRow[]);
          setDrc03Rows((drc03Res.data || []) as StatusRow[]);
        }
      } catch (e: any) {
        if (!cancelled) setError(e?.message || 'Failed to load notices');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return { rows, refundRows, drc03Rows, loading, error };
}
