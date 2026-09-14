import { supabase } from '@/integrations/supabase/client';

type EventType =
  | 'captured' | 'changed' | 'removed'
  | 'assigned' | 'status_changed'
  | 'reply_logged' | 'order_logged'
  | 'closed' | 'reopened';

interface LogEventParams {
  noticeId: string;
  clientId: string;
  eventType: EventType;
  oldValue?: Record<string, unknown> | null;
  newValue?: Record<string, unknown> | null;
  actorId?: string | null;
  actorName?: string | null;
}

export async function logNoticeEvent(params: LogEventParams): Promise<void> {
  await supabase.from('notice_events').insert({
    notice_id: params.noticeId,
    client_id: params.clientId,
    event_type: params.eventType,
    old_value: params.oldValue ?? null,
    new_value: params.newValue ?? null,
    actor_id: params.actorId ?? null,
    actor_name: params.actorName ?? null,
  });
}

export async function logNoticeFieldChanges(
  noticeId: string,
  clientId: string,
  oldFields: Record<string, unknown>,
  newFields: Record<string, unknown>,
  actorId?: string | null,
  actorName?: string | null,
): Promise<void> {
  const events: LogEventParams[] = [];

  if (oldFields.staff_status !== newFields.staff_status) {
    const isClosed = /^(closed|withdrawn|dropped|disposed|deleted|adjudged)/i.test(
      String(newFields.staff_status ?? ''),
    );
    const wasOpen = !/^(closed|withdrawn|dropped|disposed|deleted|adjudged)/i.test(
      String(oldFields.staff_status ?? ''),
    );
    if (isClosed && wasOpen) {
      events.push({
        noticeId, clientId, eventType: 'closed', actorId, actorName,
        oldValue: { staff_status: oldFields.staff_status },
        newValue: { staff_status: newFields.staff_status, close_reason: newFields.close_reason },
      });
    } else if (!isClosed && !wasOpen) {
      events.push({
        noticeId, clientId, eventType: 'reopened', actorId, actorName,
        oldValue: { staff_status: oldFields.staff_status },
        newValue: { staff_status: newFields.staff_status },
      });
    } else {
      events.push({
        noticeId, clientId, eventType: 'status_changed', actorId, actorName,
        oldValue: { staff_status: oldFields.staff_status },
        newValue: { staff_status: newFields.staff_status },
      });
    }
  }

  if (oldFields.assign_to_user_id !== newFields.assign_to_user_id) {
    events.push({
      noticeId, clientId, eventType: 'assigned', actorId, actorName,
      oldValue: { assign_to_user_id: oldFields.assign_to_user_id, assign_to: oldFields.assign_to },
      newValue: { assign_to_user_id: newFields.assign_to_user_id, assign_to: newFields.assign_to },
    });
  }

  if (!oldFields.reply_date && newFields.reply_date) {
    events.push({
      noticeId, clientId, eventType: 'reply_logged', actorId, actorName,
      newValue: { reply_date: newFields.reply_date, reply_ref_number: newFields.reply_ref_number },
    });
  }

  if (!oldFields.order_date && newFields.order_date) {
    events.push({
      noticeId, clientId, eventType: 'order_logged', actorId, actorName,
      newValue: { order_date: newFields.order_date, order_number: newFields.order_number },
    });
  }

  for (const ev of events) {
    await logNoticeEvent(ev);
  }
}
