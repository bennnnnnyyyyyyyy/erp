import { useEffect, useRef, type RefObject } from 'react';
import { Button } from './ui/button';
import { cn } from '../lib/cn';
import { useI18n, type Lang } from '../lib/i18n';

// Language selection. The chooser is the first thing a new person sees in the tutorial: it is written in BOTH languages (each with its
// own lang and dir) so someone who reads only Arabic is not asked in English. Nothing is forced: the choice is the person's own, kept
// in this browser (see lib/i18n.tsx), and it can be changed any time with the switch or in Settings > General.

/**
 * Keyboard behaviour for a dialog that covers the app: focus moves into it when it opens, and Tab and Shift+Tab stay inside it, so the page
 * behind cannot be reached by accident. (It does not close on Escape: the chooser's own buttons are the way out.)
 */
export function useDialogFocus(ref: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const focusables = () => [...root.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])')];
    focusables()[0]?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const items = focusables();
      if (items.length === 0) return;
      const first = items[0] as HTMLElement;
      const last = items[items.length - 1] as HTMLElement;
      const active = document.activeElement;
      if (e.shiftKey && (active === first || !root.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !root.contains(active))) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [ref]);
}
export function LanguageChooser({ withDefault = false }: { withDefault?: boolean }) {
  const { setPersonalLang } = useI18n();
  return (
    <div className="mx-auto mt-6 max-w-2xl rounded-xl border border-border bg-card p-6 text-card-foreground shadow-xs" role="group" aria-labelledby="lang-chooser-title">
      <h1 id="lang-chooser-title" className="m-0 text-xl font-semibold">
        <span lang="en" dir="ltr">Choose your language</span>
        <span className="mx-2 text-muted-foreground" aria-hidden="true">·</span>
        <span lang="ar" dir="rtl">اختر لغتك</span>
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">
        <span lang="en" dir="ltr" className="block">Choose the language you want to use. The menus, the home page, the tutorial and the tour follow it. You can change it any time.</span>
        <span lang="ar" dir="rtl" className="mt-1 block">اختر اللغة التي تريد استخدامها. تتبعها القوائم والصفحة الرئيسية والدليل والجولة. يمكنك تغييرها في أي وقت.</span>
      </p>
      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <Button variant="outline" className="h-12 text-base" lang="en" dir="ltr" onClick={() => setPersonalLang('en')}>English</Button>
        <Button variant="outline" className="h-12 text-base" lang="ar" dir="rtl" onClick={() => setPersonalLang('ar')}>العربية</Button>
      </div>
      {withDefault && (
        <div className="mt-3">
          <Button variant="ghost" className="h-10 w-full text-sm" onClick={() => setPersonalLang(null)}>
            <span lang="en" dir="ltr">Use my company's default language</span>
            <span className="mx-2 text-muted-foreground" aria-hidden="true">·</span>
            <span lang="ar" dir="rtl">استخدم لغة الشركة الافتراضية</span>
          </Button>
        </div>
      )}
      <p className="mt-4 text-xs text-muted-foreground">
        <span lang="en" dir="ltr" className="block">Every screen is available in Arabic. Some wording is still being reviewed.</span>
        <span lang="ar" dir="rtl" className="mt-1 block">كل الشاشات متاحة بالعربية. ما زالت بعض الصياغات قيد المراجعة.</span>
      </p>
    </div>
  );
}

/** A small English | العربية switch for pages that follow the person's language, so it can be changed without leaving the page. */
export function LanguageSwitch({ className }: { className?: string }) {
  const { lang, setPersonalLang } = useI18n();
  const options: { value: Lang; label: string }[] = [
    { value: 'en', label: 'English' },
    { value: 'ar', label: 'العربية' },
  ];
  return (
    <div className={cn('inline-flex overflow-hidden rounded-lg border border-border text-sm', className)} role="group" aria-label="Language / اللغة">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          lang={o.value}
          aria-pressed={lang === o.value}
          onClick={() => setPersonalLang(o.value)}
          className={cn('min-h-10 px-3 py-2', lang === o.value ? 'bg-accent font-semibold text-foreground ring-2 ring-inset ring-primary' : 'bg-card text-muted-foreground hover:bg-accent')}
        >
          {lang === o.value ? <span aria-hidden="true">✓ </span> : null}{o.label}
        </button>
      ))}
    </div>
  );
}

/** Shown once, over the app, to a signed-in person who has never been asked. Any answer (even the company default) ends the question for good. */
export function FirstRunLanguage() {
  const ref = useRef<HTMLDivElement>(null);
  useDialogFocus(ref);
  return (
    <div ref={ref} className="fixed inset-0 z-[70] flex items-center justify-center overflow-auto bg-black/60 p-4" role="dialog" aria-modal="true" aria-labelledby="lang-chooser-title">
      <div className="w-full max-w-2xl">
        <LanguageChooser withDefault />
      </div>
    </div>
  );
}
