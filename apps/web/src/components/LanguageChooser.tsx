import { Button } from './ui/button';
import { cn } from '../lib/cn';
import { useI18n, type Lang } from '../lib/i18n';

// Language selection. The chooser is the first thing a new person sees in the tutorial: it is written in BOTH languages (each with its
// own lang and dir) so someone who reads only Arabic is not asked in English. Nothing is forced: the choice is the person's own, kept
// in this browser (see lib/i18n.tsx), and it can be changed any time with the switch or in Settings > General.

export function LanguageChooser() {
  const { setPersonalLang } = useI18n();
  return (
    <div className="mx-auto mt-6 max-w-2xl rounded-xl border border-border bg-card p-6 text-card-foreground shadow-xs" role="group" aria-labelledby="lang-chooser-title">
      <h1 id="lang-chooser-title" className="m-0 text-xl font-semibold">
        <span lang="en" dir="ltr">Choose your language</span>
        <span className="mx-2 text-muted-foreground" aria-hidden="true">·</span>
        <span lang="ar" dir="rtl">اختر لغتك</span>
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">
        <span lang="en" dir="ltr" className="block">The tutorial will be shown in the language you pick. You can change it any time.</span>
        <span lang="ar" dir="rtl" className="mt-1 block">سيُعرض الدليل باللغة التي تختارها. يمكنك تغييرها في أي وقت.</span>
      </p>
      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <Button variant="outline" className="h-12 text-base" lang="en" dir="ltr" onClick={() => setPersonalLang('en')}>English</Button>
        <Button variant="outline" className="h-12 text-base" lang="ar" dir="rtl" onClick={() => setPersonalLang('ar')}>العربية</Button>
      </div>
      <p className="mt-4 text-xs text-muted-foreground">
        <span lang="en" dir="ltr" className="block">Arabic is a first draft awaiting review by a native speaker. Menus, this tutorial and the Guide are translated; other screens stay in English for now.</span>
        <span lang="ar" dir="rtl" className="mt-1 block">العربية مسودة أولى بانتظار مراجعة متحدث أصلي. القوائم وهذا الدليل ودليل الاستخدام مترجمة؛ وتبقى بقية الشاشات بالإنجليزية حاليًا.</span>
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
          className={cn('px-3 py-1.5', lang === o.value ? 'bg-accent font-semibold text-foreground ring-2 ring-inset ring-primary' : 'bg-card text-muted-foreground hover:bg-accent')}
        >
          {lang === o.value ? '✓ ' : ''}{o.label}
        </button>
      ))}
    </div>
  );
}
