// What the user's screen shows, read from the live page for the GST Assistant
// (23 Nov 2026). Whatever a screen holds today (a tab, button or field added
// last week included) is read here, so the assistant never waits for anyone to
// describe a new feature. Also finds an element by its visible label, for the
// guided walk, the numbered screenshot and filling a field.

export interface SnapshotField { label: string; type: string; value: string; row?: string }
export interface SnapshotTable { headers: string[]; rows: string[][]; rowCount: number }
export interface PageSnapshot {
  route: string;
  title: string | null;
  client: { id: string; name: string | null } | null;
  period: string | null;
  headings: string[];
  tabs: { label: string; active: boolean }[];
  buttons: string[];
  fields: SnapshotField[];
  tables: SnapshotTable[];
  dialog: string | null;
}

const text = (el: Element | null | undefined) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
const visible = (el: Element) => {
  const r = (el as HTMLElement).getBoundingClientRect?.();
  if (!r || (r.width === 0 && r.height === 0)) return false;
  const st = getComputedStyle(el as HTMLElement);
  return st.visibility !== 'hidden' && st.display !== 'none';
};
const notAssistant = (el: Element) => !el.closest('[data-assistant-root]');

/** The area the user works in: an open dialog first, else the page. */
export function workArea(): Element {
  const dialogs = [...document.querySelectorAll('[role="dialog"], [role="alertdialog"]')].filter((d) => visible(d) && notAssistant(d));
  return dialogs.at(-1) ?? document.querySelector('main') ?? document.body;
}

/** The label a person reads for a control. */
export function labelOf(el: Element): string {
  const h = el as HTMLInputElement;
  const aria = el.getAttribute('aria-label');
  if (aria) return aria.trim();
  const by = el.getAttribute('aria-labelledby');
  if (by) {
    const t = by.split(/\s+/).map((id) => text(document.getElementById(id))).join(' ').trim();
    if (t) return t;
  }
  if (h.id) {
    const l = document.querySelector(`label[for="${CSS.escape(h.id)}"]`);
    if (l && text(l)) return text(l);
  }
  const wrap = el.closest('label');
  if (wrap && text(wrap)) return text(wrap);
  if (h.placeholder) return h.placeholder;
  // A label written just before the control in the same group.
  // Only when the group holds this one control, and the label is not another's.
  const group = el.parentElement;
  const prev = group?.querySelector('label');
  const controls = group?.querySelectorAll('input:not([type="hidden"]), textarea, select, [role="combobox"], [role="switch"], [role="checkbox"]').length ?? 0;
  if (prev && text(prev) && controls === 1 && (!prev.htmlFor || prev.htmlFor === h.id)) return text(prev);
  // A cell's own row label: the first cell of the row, with the column heading.
  const cell0 = el.closest('td');
  const cell = cell0;
  if (cell) {
    const table = cell.closest('table');
    const idx = (cell as HTMLTableCellElement).cellIndex;
    const head = table?.querySelector('thead tr:last-child')?.children[idx];
    if (head && text(head)) return text(head);
  }
  return h.name || '';
}

/** Text that identifies the table row a control is in. */
export function rowOf(el: Element): string | undefined {
  const tr = el.closest('tr');
  if (!tr) return undefined;
  const cells = [...tr.children].slice(0, 3).map((c) => text(c)).filter(Boolean);
  return cells.join(' · ').slice(0, 80) || undefined;
}

function valueOf(el: Element): string {
  if (el instanceof HTMLInputElement) {
    if (el.type === 'checkbox' || el.type === 'radio') return el.checked ? 'checked' : 'unchecked';
    return el.value;
  }
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return el.value;
  if (el.getAttribute('role') === 'combobox') return text(el);
  if (el.getAttribute('role') === 'switch' || el.getAttribute('role') === 'checkbox') return el.getAttribute('aria-checked') === 'true' ? 'on' : 'off';
  return text(el);
}

export function takeSnapshot(ctx: { route: string; clientId: string | null; clientName: string | null; period: string | null }): PageSnapshot {
  const area = workArea();
  const main = document.querySelector('main') ?? document.body;
  const headings = [...main.querySelectorAll('h1, h2, h3')].filter((h) => visible(h) && notAssistant(h)).map(text).filter(Boolean).slice(0, 20);
  const tabs = [...main.querySelectorAll('[role="tab"]')].filter((t) => visible(t) && notAssistant(t)).map((t) => ({ label: text(t), active: t.getAttribute('aria-selected') === 'true' || t.getAttribute('data-state') === 'active' })).filter((t) => t.label).slice(0, 40);
  const buttons = [...new Set([...area.querySelectorAll('button, a[href], [role="button"], [role="menuitem"]')].filter((b) => visible(b) && notAssistant(b) && b.getAttribute('role') !== 'tab').map((b) => labelOf(b) || text(b)).filter((t) => t && t.length <= 60))].slice(0, 80);
  const fields: SnapshotField[] = [];
  for (const el of area.querySelectorAll('input, textarea, select, [role="combobox"], [role="switch"], [role="checkbox"]')) {
    if (!visible(el) || !notAssistant(el)) continue;
    const type = el instanceof HTMLInputElement ? el.type : el.tagName.toLowerCase() === 'button' ? (el.getAttribute('role') ?? 'button') : el.tagName.toLowerCase();
    if (type === 'hidden' || type === 'password' || type === 'file') continue;
    const label = labelOf(el);
    if (!label) continue;
    fields.push({ label: label.slice(0, 80), type, value: valueOf(el).slice(0, 80), row: rowOf(el) });
    if (fields.length >= 120) break;
  }
  const tables: SnapshotTable[] = [];
  for (const t of main.querySelectorAll('table')) {
    if (!visible(t) || !notAssistant(t)) continue;
    const headers = [...(t.querySelector('thead tr:last-child')?.children ?? [])].map(text).slice(0, 30);
    const bodyRows = [...t.querySelectorAll('tbody tr')];
    const rows = bodyRows.slice(0, 12).map((r) => [...r.children].map((c) => {
      const inp = c.querySelector('input, textarea, select') as HTMLInputElement | null;
      return (inp ? inp.value : text(c)).slice(0, 40);
    }).slice(0, 30));
    tables.push({ headers, rows, rowCount: bodyRows.length });
    if (tables.length >= 4) break;
  }
  const dlg = area !== main && area !== document.body ? (text(area.querySelector('h2, [role="heading"]')) || 'a dialog') : null;
  return {
    route: ctx.route,
    title: headings[0] ?? document.title ?? null,
    client: ctx.clientId ? { id: ctx.clientId, name: ctx.clientName } : null,
    period: ctx.period,
    headings,
    tabs,
    buttons,
    fields,
    tables,
    dialog: dlg,
  };
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9₹%./ ]/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * The element a person would mean by this label: exact match first, then a
 * label that starts with it, then one that contains it. Controls before plain
 * text; inside the given row when one is named.
 */
export function findTarget(label: string | undefined | null, opts: { row?: string; controlsOnly?: boolean } = {}): HTMLElement | null {
  if (!label) return null;
  const want = norm(label);
  if (!want) return null;
  const root = workArea();
  const controls = 'input, textarea, select, [role="combobox"], [role="switch"], [role="checkbox"]';
  const clickables = 'button, a[href], [role="tab"], [role="button"], [role="menuitem"], [role="option"], summary';
  const groups = opts.controlsOnly ? [controls] : [controls, clickables, 'label, th, h1, h2, h3, h4, legend, td, span, p, div'];
  const rowWant = opts.row ? norm(opts.row) : null;
  for (const sel of groups) {
    const els = [...root.querySelectorAll(sel)].filter((e) => visible(e) && notAssistant(e)) as HTMLElement[];
    const inRow = rowWant ? els.filter((e) => { const tr = e.closest('tr'); return tr ? norm(text(tr)).includes(rowWant) : false; }) : els;
    const pool = inRow.length ? inRow : els;
    const name = (e: HTMLElement) => norm(sel === controls ? labelOf(e) : (labelOf(e) || text(e)));
    // Plain text: only small elements, so a whole page section is never "the target".
    const small = (e: HTMLElement) => sel !== groups[2] || (text(e).length <= Math.max(60, want.length + 20) && e.children.length <= 3);
    const exact = pool.find((e) => small(e) && name(e) === want);
    if (exact) return exact;
    const starts = pool.find((e) => small(e) && name(e).startsWith(want));
    if (starts) return starts;
    const has = pool.find((e) => small(e) && want.length >= 3 && name(e).includes(want));
    if (has) return has;
  }
  return null;
}
