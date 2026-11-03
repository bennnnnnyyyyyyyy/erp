import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { LanguageChooser, LanguageSwitch, useDialogFocus } from '../../components/LanguageChooser';
import { Button } from '../../components/ui/button';
import { useI18n } from '../../lib/i18n';
import { navigate, usePath } from '../../lib/router';
import { useSession } from '../../session';
import { tourContent } from './tourContent';
import { placeTooltip, stepsFor, type Box } from './tourSteps';

// The guided tour (plan: documentation/plans/IN_APP_TOUR_PLAN.md). One overlay, mounted once in the Shell: it walks the person across the
// real screens, highlights the real element, and explains it in their language and direction.
//
// Rules it keeps:
//  * It never starts before the person has chosen a language: the chooser comes first (and Cancel ends it).
//  * Steps the person's role cannot use are left out (stepsFor), and a step whose element never appears is skipped, never stuck.
//  * It never blocks the app: the highlight lets clicks through, Escape closes, and going to another screen ends the tour.
//  * Changing the language in the middle keeps the same step and only re-renders its words.

const START = 'erp:tour';
const DONE_KEY = 'erp.tour.done';
const WAIT_MS = 4000;

/** Starts the tour from anywhere (a button on the tutorial or the Guide). */
export function startTour(): void {
  window.dispatchEvent(new Event(START));
}

function tourDone(): boolean {
  try {
    return localStorage.getItem(DONE_KEY) === '1';
  } catch {
    return false;
  }
}

export function TourButton({ className }: { className?: string }) {
  const session = useSession();
  const { lang } = useI18n();
  // The tour is offered only in companies where an owner or admin has switched it on (Settings > General).
  if (!session.org?.showTour) return null;
  const c = tourContent(lang);
  return (
    <Button variant="outline" className={className} onClick={startTour}>
      {tourDone() ? c.replay : c.take}
    </Button>
  );
}

/** The language question the tour asks first. Its own component so keyboard focus moves into it, and stays in it, the moment it appears. */
function TourLanguageDialog({ onCancel }: { onCancel: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useDialogFocus(ref);
  return (
    <div ref={ref} className="fixed inset-0 z-[60] flex items-center justify-center bg-black/55 p-4" role="dialog" aria-modal="true" aria-labelledby="lang-chooser-title">
      <div className="w-full max-w-2xl">
        <LanguageChooser withDefault />
        <div className="mt-3 text-center">
          <Button variant="outline" className="h-10" onClick={onCancel}>
            <span lang="en">Cancel</span> · <span lang="ar">إلغاء</span>
          </Button>
        </div>
      </div>
    </div>
  );
}
export function TourHost() {
  const session = useSession();
  const { lang, asked } = useI18n();
  const path = usePath();
  const tourOn = session.org?.showTour === true;
  const steps = useMemo(() => stepsFor(session), [session]);
  const [active, setActive] = useState(false);
  const [i, setI] = useState(0);
  const [box, setBox] = useState<Box | null>(null);
  const [tip, setTip] = useState({ width: 360, height: 220 });
  const tipRef = useRef<HTMLDivElement>(null);
  // The overlay's own box. The page can have a scrollbar on either side (on the left in right-to-left layouts), which shifts anything placed
  // against the window; so everything is placed relative to this box, and its real size is what the tooltip must fit in.
  const rootRef = useRef<HTMLDivElement>(null);
  const [vp, setVp] = useState({ width: window.innerWidth, height: window.innerHeight });
  const direction = useRef<1 | -1>(1);
  const located = useRef<string | null>(null);
  // The path as React last rendered it. The browser's URL changes the instant we navigate, but the page only changes when React renders, so every
  // check below uses this, never window.location: otherwise the tour would see its own navigation as the person leaving.
  const pathRef = useRef(path);
  pathRef.current = path;
  const c = tourContent(lang);
  const step = steps[i];

  const close = useCallback((finished = false) => {
    if (finished) {
      try {
        localStorage.setItem(DONE_KEY, '1');
      } catch {
        /* storage blocked: the label just stays "Take the tour" */
      }
    }
    setActive(false);
    setBox(null);
    located.current = null;
  }, []);

  useEffect(() => {
    const on = () => {
      if (!tourOn) return;
      direction.current = 1;
      located.current = null;
      setI(0);
      setActive(true);
    };
    window.addEventListener(START, on);
    return () => window.removeEventListener(START, on);
  }, [tourOn]);

  useEffect(() => {
    if (!active) return;
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [active, close]);

  // Go to the step's screen and find its element. If it never appears, move on in the direction the person was going.
  useEffect(() => {
    if (!active || !asked || !step) return;
    setBox(null);
    located.current = null;
    if (window.location.pathname !== step.route) navigate(step.route);
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let el: Element | null = null;
    const started = Date.now();
    const update = () => {
      if (!el) return;
      const r = el.getBoundingClientRect();
      const o = rootRef.current?.getBoundingClientRect();
      const ox = o?.left ?? 0;
      const oy = o?.top ?? 0;
      setBox({ top: r.top - oy, left: r.left - ox, width: r.width, height: r.height });
      if (rootRef.current) setVp({ width: rootRef.current.clientWidth, height: rootRef.current.clientHeight });
    };
    const find = (): Element | null => {
      if (pathRef.current !== step.route) return null;
      for (const sel of step.selectors) {
        const found = document.querySelector(sel);
        if (found) {
          const r = found.getBoundingClientRect();
          if (r.width > 0 && r.height > 0) return found;
        }
      }
      return null;
    };
    // Once found, keep looking: the screen may still be rendering (the old page can be on screen for a moment after the route changes), or its
    // table may arrive after its heading. Every 250 ms the best match is re-resolved and the highlight follows it, until the step changes.
    let watch: ReturnType<typeof setInterval> | undefined;
    const refresh = () => {
      const best = find();
      if (!best) return;
      if (best !== el) {
        el = best;
        best.scrollIntoView({ block: 'center' });
      }
      update();
    };
    const tick = () => {
      if (cancelled) return;
      el = find();
      if (el) {
        located.current = step.route;
        el.scrollIntoView({ block: 'center' });
        update();
        watch = setInterval(refresh, 250);
        return;
      }
      if (Date.now() - started > WAIT_MS) {
        const next = i + direction.current;
        if (next >= steps.length) close(true);
        else if (next < 0) close();
        else setI(next);
        return;
      }
      timer = setTimeout(tick, 150);
    };
    tick();
    const on = () => update();
    window.addEventListener('resize', on);
    window.addEventListener('scroll', on, true);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      if (watch) clearInterval(watch);
      window.removeEventListener('resize', on);
      window.removeEventListener('scroll', on, true);
    };
  }, [active, asked, i, step, steps.length, close]);

  // Going to another screen by hand ends the tour: it never fights the person for the page.
  useEffect(() => {
    if (active && located.current && path !== located.current) close();
  }, [path, active, close]);

  useLayoutEffect(() => {
    const el = tipRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (Math.abs(r.width - tip.width) > 1 || Math.abs(r.height - tip.height) > 1) setTip({ width: r.width, height: r.height });
  });

  // Keyboard and screen-reader users: focus moves to the tooltip when the step changes, and only then.
  useEffect(() => {
    if (active && asked) tipRef.current?.focus({ preventScroll: true });
  }, [active, asked, i, box === null]);

  if (!active || !tourOn) return null;

  // First, a language. Nothing of the tour is shown until the person has been asked (English, Arabic or the company default).
  if (!asked) return <TourLanguageDialog onCancel={() => close()} />;
  if (!step) return null;

  const text = c.steps[step.id];
  const viewport = vp;
  const width = Math.min(360, viewport.width - 16);
  const pos = box
    ? placeTooltip(box, { width, height: tip.height }, viewport)
    : { top: Math.max(8, viewport.height - tip.height - 16), left: Math.max(8, (viewport.width - width) / 2), placement: 'pinned' as const };
  const last = i === steps.length - 1;
  const arrow = lang === 'ar' ? '←' : '→';
  const backArrow = lang === 'ar' ? '→' : '←';

  return (
    <div ref={rootRef} className="pointer-events-none fixed inset-0 z-[60]" data-tour-overlay>
      {box && (
        <div
          aria-hidden="true"
          style={{ position: 'absolute', top: box.top - 6, left: box.left - 6, width: box.width + 12, height: box.height + 12, borderRadius: 12, boxShadow: '0 0 0 9999px rgba(0,0,0,0.55)', outline: '3px solid #f59e0b', pointerEvents: 'none' }}
        />
      )}
      <div
        ref={tipRef}
        role="dialog"
        aria-label={`${c.tour}: ${text?.title ?? ''}`}
        tabIndex={-1}
        className="pointer-events-auto rounded-xl border border-border bg-card p-4 text-card-foreground shadow-lg outline-none"
        style={{ position: 'absolute', top: pos.top, left: pos.left, width }}
      >
        <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
          <span aria-live="polite">{c.stepOf(i + 1, steps.length)}</span>
          <Button variant="ghost" size="icon" className="size-10" aria-label={c.close} onClick={() => close()}>✕</Button>
        </div>
        <h2 className="m-0 mt-1 text-base font-semibold">{text?.title}</h2>
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{text?.body}</p>
        {i === 0 && c.screenNote ? <p className="mt-2 text-xs text-muted-foreground">{c.screenNote}</p> : null}
        {i === 0 && c.draftNote ? <p className="mt-1 text-xs text-muted-foreground">{c.draftNote}</p> : null}
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <LanguageSwitch className="text-xs" />
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" className="h-10 px-3" disabled={i === 0} onClick={() => { direction.current = -1; setI(i - 1); }}><span aria-hidden="true">{backArrow}</span> {c.back}</Button>
            {last ? (
              <Button size="sm" className="h-10 px-4" onClick={() => close(true)}>{c.finish}</Button>
            ) : (
              <Button size="sm" className="h-10 px-4" onClick={() => { direction.current = 1; setI(i + 1); }}>{c.next} <span aria-hidden="true">{arrow}</span></Button>
            )}
          </div>
        </div>
        <div className="mt-2 text-end">
          <Button variant="ghost" size="sm" className="h-10 text-xs text-muted-foreground underline" onClick={() => close()}>{c.skip}</Button>
        </div>
      </div>
    </div>
  );
}
