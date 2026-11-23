// The numbered screenshot of the GST Assistant (23 Nov 2026): a picture of the
// user's own screen with each step's target ringed and numbered, so an answer
// shows exactly where to click when doing it by hand. Taken in the browser
// (html-to-image, loaded only when asked); never sent anywhere.

import { findTarget, workArea } from './pageSnapshot';

export interface ShotStep { target?: string; instruction: string; route?: string }

export async function annotatedScreenshot(steps: ShotStep[], currentRoute: string): Promise<{ url: string; found: number[] } | null> {
  const area = (workArea() as HTMLElement) ?? document.body;
  const { toCanvas } = await import('html-to-image');
  const box = area.getBoundingClientRect();
  const width = Math.min(Math.max(box.width, 320), 1600);
  const height = Math.min(Math.max(box.height, 200), 2400);
  let canvas: HTMLCanvasElement;
  try {
    canvas = await toCanvas(area, {
      pixelRatio: 1,
      width,
      height,
      cacheBust: true,
      backgroundColor: getComputedStyle(document.body).backgroundColor || '#ffffff',
      filter: (n) => !(n instanceof Element && n.closest('[data-assistant-root]')),
    });
  } catch {
    return null;
  }
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const primary = getComputedStyle(document.documentElement).getPropertyValue('--primary').trim();
  const accent = primary ? `hsl(${primary})` : '#1d4ed8';
  const found: number[] = [];
  steps.forEach((s, i) => {
    if (s.route && s.route !== currentRoute) return;
    const el = findTarget(s.target);
    if (!el) return;
    const r = el.getBoundingClientRect();
    const x = r.left - box.left;
    const y = r.top - box.top;
    if (x > width || y > height || x + r.width < 0 || y + r.height < 0) return;
    found.push(i);
    ctx.lineWidth = 3;
    ctx.strokeStyle = accent;
    ctx.strokeRect(x - 4, y - 4, r.width + 8, r.height + 8);
    const cx = Math.max(14, x - 4);
    const cy = Math.max(14, y - 4);
    ctx.beginPath();
    ctx.fillStyle = accent;
    ctx.arc(cx, cy, 13, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 14px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(i + 1), cx, cy + 1);
  });
  return { url: canvas.toDataURL('image/png'), found };
}
