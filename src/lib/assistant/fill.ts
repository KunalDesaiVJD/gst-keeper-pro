// Typing the assistant's proposed figures into the screen's own fields, once
// the user pressed Apply (23 Nov 2026). The value goes in the way a person's
// typing does (the native setter, then input / change / blur), so the screen's
// own state, validation and Save see an ordinary edit; nothing here writes to
// the database. "Apply and save" then presses the screen's own Save button,
// with this tab's requests tagged "assistant" for Change History.

import { findTarget } from './pageSnapshot';
import { setChangeLogPageTag } from '@/lib/changeLogHeaders';

export interface FillField { target: string; value: string; row?: string; current?: string }
export interface FillOutcome { field: FillField; ok: boolean; note?: string }

function setNative(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  el.focus();
  setter?.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  el.dispatchEvent(new Event('blur', { bubbles: true }));
  el.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
}

const truthy = (v: string) => /^(true|yes|on|checked|1|y)$/i.test(v.trim());

export function fillOne(f: FillField): FillOutcome {
  const el = findTarget(f.target, { row: f.row, controlsOnly: true });
  if (!el) return { field: f, ok: false, note: 'Field not found on this screen' };
  if ((el as HTMLInputElement).disabled || el.getAttribute('aria-disabled') === 'true' || (el as HTMLInputElement).readOnly) {
    return { field: f, ok: false, note: 'The screen does not let you change this field' };
  }
  if (el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio')) {
    if (el.checked !== truthy(f.value)) el.click();
    return { field: f, ok: true };
  }
  if (el.getAttribute('role') === 'switch' || el.getAttribute('role') === 'checkbox') {
    const on = el.getAttribute('aria-checked') === 'true';
    if (on !== truthy(f.value)) el.click();
    return { field: f, ok: true };
  }
  if (el instanceof HTMLSelectElement) {
    const opt = [...el.options].find((o) => o.value === f.value || o.text.trim().toLowerCase() === f.value.trim().toLowerCase());
    if (!opt) return { field: f, ok: false, note: 'That choice is not in the list' };
    el.value = opt.value;
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return { field: f, ok: true };
  }
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    setNative(el, f.value);
    return { field: f, ok: true };
  }
  // A dropdown built from buttons (Radix select / combobox): left for the person.
  el.scrollIntoView({ block: 'center' });
  return { field: f, ok: false, note: 'Pick this one by hand: it is a dropdown' };
}

export async function applyFill(fields: FillField[], opts: { saveButton?: string | null; save: boolean }): Promise<{ outcomes: FillOutcome[]; saved: boolean; saveNote?: string }> {
  const outcomes: FillOutcome[] = [];
  for (const f of fields) {
    outcomes.push(fillOne(f));
    // Let the screen re-render between fields (rows can appear as figures change).
    await new Promise((r) => setTimeout(r, 60));
  }
  if (!opts.save || !opts.saveButton) return { outcomes, saved: false };
  if (outcomes.some((o) => !o.ok)) return { outcomes, saved: false, saveNote: 'Not saved: some fields could not be filled. Check them, then press Save yourself.' };
  await new Promise((r) => setTimeout(r, 150));
  const btn = findTarget(opts.saveButton);
  if (!btn) return { outcomes, saved: false, saveNote: `The ${opts.saveButton} button was not found: press Save yourself.` };
  if ((btn as HTMLButtonElement).disabled) return { outcomes, saved: false, saveNote: `${opts.saveButton} is not available right now: the screen may need more input.` };
  setChangeLogPageTag('assistant', 30_000);
  btn.click();
  return { outcomes, saved: true };
}
