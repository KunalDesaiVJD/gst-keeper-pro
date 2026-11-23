// The guided walk of the GST Assistant (23 Nov 2026): one step at a time, the
// step's button or field ringed on the user's own screen with a card that
// says what to do there. A step on another screen offers to go there first.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowRight, MapPin, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { findTarget } from '@/lib/assistant/pageSnapshot';

export interface GuideStep { route?: string; target?: string; instruction: string }

const samePath = (a: string, b: string) => a.replace(/\/+$/, '') === b.replace(/\/+$/, '');

const pathOf = (r: string) => r.split(/[?#]/)[0];

const GuideOverlay: React.FC<{ title: string; steps: GuideStep[]; origin: string; onClose: () => void }> = ({ title, steps: given, origin, onClose }) => {
  const [i, setI] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const location = useLocation();
  const navigate = useNavigate();
  // A step with no screen of its own happens where the step before it did
  // (the first one where the guide was asked), never on whatever screen the
  // user is on when they reach it.
  const steps = useMemo(() => {
    let at = pathOf(origin);
    return given.map((s) => {
      if (s.route && !s.route.includes(':')) at = s.route;
      return { ...s, route: at };
    });
  }, [given, origin]);
  const step = steps[i];
  const elRef = useRef<HTMLElement | null>(null);
  const elsewhere = !!step?.route && !samePath(pathOf(step.route), location.pathname);

  useEffect(() => {
    if (!step || elsewhere) { setRect(null); return; }
    let el: HTMLElement | null = null;
    const find = () => {
      if (!el || !el.isConnected) {
        el = findTarget(step.target);
        if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
      elRef.current = el;
      setRect(el ? el.getBoundingClientRect() : null);
    };
    find();
    const t = window.setInterval(find, 400);
    window.addEventListener('scroll', find, true);
    window.addEventListener('resize', find);
    return () => { window.clearInterval(t); window.removeEventListener('scroll', find, true); window.removeEventListener('resize', find); };
  }, [step, elsewhere, location.pathname]);

  // Using the ringed button or tab moves the walk on by itself.
  useEffect(() => {
    if (!step || elsewhere) return;
    const onClick = (e: MouseEvent) => {
      const el = elRef.current;
      if (!el || !(e.target instanceof Node) || !el.contains(e.target)) return;
      if (el.matches('input, textarea, select, [role="combobox"]')) return;
      if (i < steps.length - 1) window.setTimeout(() => setI((n) => (n === i ? n + 1 : n)), 350);
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, [step, elsewhere, i, steps.length]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!step) return null;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const cardW = Math.min(340, vw - 32);
  let top = vh - 230;
  let left = 16;
  if (rect) {
    top = rect.bottom + 12 + 170 < vh ? rect.bottom + 12 : Math.max(16, rect.top - 182);
    left = Math.min(Math.max(16, rect.left), vw - cardW - 16);
  }

  return createPortal(
    <div data-assistant-root className="fixed inset-0 z-[60] pointer-events-none">
      {rect && (
        <div
          className="absolute rounded-md ring-4 ring-primary/80 shadow-[0_0_0_9999px_rgba(15,23,42,0.35)] transition-all duration-200"
          style={{ top: rect.top - 6, left: rect.left - 6, width: rect.width + 12, height: rect.height + 12 }}
        />
      )}
      <div className="absolute pointer-events-auto rounded-lg border bg-card p-3 shadow-xl" style={{ top, left, width: cardW }}>
        <div className="flex items-start justify-between gap-2">
          <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{title} · Step {i + 1} of {steps.length}</div>
          <button type="button" aria-label="Stop the guide" className="text-muted-foreground hover:text-foreground" onClick={onClose}><X className="h-4 w-4" /></button>
        </div>
        <p className="mt-1.5 text-sm text-foreground">{step.instruction}</p>
        {step.target && !elsewhere && !rect && (
          <p className="mt-1 text-xs text-muted-foreground">Look for “{step.target}”: it is not visible on the screen right now (it may be in a menu, another tab or further down).</p>
        )}
        {elsewhere && (
          <Button size="sm" variant="outline" className="mt-2 h-8 gap-1 text-xs" onClick={() => navigate(step.route)}>
            <MapPin className="h-3.5 w-3.5" /> Go to this screen
          </Button>
        )}
        <div className="mt-3 flex items-center justify-between">
          <Button size="sm" variant="ghost" className="h-8 gap-1 text-xs" disabled={i === 0} onClick={() => setI(i - 1)}>
            <ArrowLeft className="h-3.5 w-3.5" /> Back
          </Button>
          {i < steps.length - 1 ? (
            <Button size="sm" className="h-8 gap-1 text-xs" onClick={() => setI(i + 1)}>Next <ArrowRight className="h-3.5 w-3.5" /></Button>
          ) : (
            <Button size="sm" className="h-8 text-xs" onClick={onClose}>Done</Button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
};

export default GuideOverlay;
