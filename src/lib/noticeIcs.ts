// An .ics file for hearings and deadlines (audit U-11-4, U-43-2), so they can
// go into Outlook or Google Calendar. All-day events on IST calendar dates.
export interface IcsItem { uid: string; date: string; title: string; description?: string }

const esc = (v: string) => v.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const day = (iso: string) => iso.slice(0, 10).replace(/-/g, '');
function nextDay(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10).replace(/-/g, '');
}

export function buildIcs(items: IcsItem[], calName = 'GST Keeper notices'): string {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//GST Keeper//Notices//EN', `X-WR-CALNAME:${esc(calName)}`, 'CALSCALE:GREGORIAN'];
  items.forEach((it) => {
    lines.push('BEGIN:VEVENT', `UID:${it.uid}@gst-keeper`, `DTSTAMP:${stamp}`, `DTSTART;VALUE=DATE:${day(it.date)}`,
      `DTEND;VALUE=DATE:${nextDay(it.date)}`, `SUMMARY:${esc(it.title)}`);
    if (it.description) lines.push(`DESCRIPTION:${esc(it.description)}`);
    lines.push('END:VEVENT');
  });
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

export function downloadIcs(items: IcsItem[], filename: string, calName?: string) {
  const blob = new Blob([buildIcs(items, calName)], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.ics') ? filename : `${filename}.ics`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
