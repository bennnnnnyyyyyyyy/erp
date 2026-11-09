import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

// English / Arabic. The English text itself is the key, so a missing translation shows English and never a blank or a code.
// The Arabic below is a MACHINE DRAFT for the shell only and needs review by a native speaker before it is shown to customers.

import { NAV_AR } from './i18nNav';
import { SCREENS_AR } from './i18nScreens';
import { AUDIT_AR } from './i18nAudit';
import { ERRORS_AR } from './i18nErrors';

export type Lang = 'en' | 'ar';

const AR: Record<string, string> = {
  Apps: 'التطبيقات',
  Menu: 'القائمة',
  'All apps': 'كل التطبيقات',
  'Switch organization': 'تبديل المؤسسة',
  'Sign out': 'تسجيل الخروج',
  Language: 'اللغة',
  'Switch to light mode': 'التبديل إلى الوضع الفاتح',
  'Switch to dark mode': 'التبديل إلى الوضع الداكن',
  'Page not found': 'الصفحة غير موجودة',
  "This page doesn't exist or you don't have access to it.": 'هذه الصفحة غير موجودة أو ليس لديك صلاحية الوصول إليها.',
  'Back to apps': 'العودة إلى التطبيقات',
  'My language': 'لغتي',
  'Company default': 'الافتراضي للشركة',
  'English (left to right)': 'الإنجليزية (من اليسار إلى اليمين)',
  'Arabic (right to left)': 'العربية (من اليمين إلى اليسار)',
};

Object.assign(AR, NAV_AR, SCREENS_AR, AUDIT_AR, ERRORS_AR);

// The language in use right now, readable from anywhere (including plain functions and column definitions that are not React components).
// The provider sets it while rendering, before any child renders; the page is re-mounted when the language changes, so nothing keeps a stale text.
let currentLang: Lang = 'en';

/** The language in use right now (for date and number formatting in plain functions). */
export const currentLanguage = (): Lang => currentLang;

/** The locale for dates: Arabic names, Western digits (like the rest of the app), or British English. */
export const dateLocale = (): string => (currentLang === 'ar' ? 'ar-EG-u-nu-latn' : 'en-GB');

/** Translates an English text to the language in use. Missing Arabic shows the English text, never a blank or a code. Safe to call anywhere during render. */
export function tr(text: string): string {
  return currentLang === 'ar' ? (AR[text] ?? text) : text;
}

/** Like tr(), then fills {name} placeholders: trf('{n} items', { n: 3 }). The Arabic text may put the placeholders in a different order. */
export function trf(template: string, values: Record<string, string | number>): string {
  return tr(template).replace(/\{(\w+)\}/g, (m, k: string) => (k in values ? String(values[k]) : m));
}

/** How many UI strings have an Arabic text. Shown honestly in the language menu so nobody assumes the whole app is translated. */
export const arabicStringCount = Object.keys(AR).length;

const KEY = 'erp.lang';
const ASKED_KEY = 'erp.lang.asked';

function storedAsked(): boolean {
  try {
    return localStorage.getItem(ASKED_KEY) === '1';
  } catch {
    return false;
  }
}

// A person's own choice wins; with none, the company's language applies; with neither, English. Nothing forces a language: the company
// language is only a default. The choice is saved on the person's ACCOUNT (sql/038) so it follows them to another browser or device, and
// also kept in this browser so the right language shows before the account has loaded. When both exist, the account wins.
function storedLang(): Lang | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'ar' || v === 'en' ? v : null;
  } catch {
    return null;
  }
}

export type AccountSync = {
  /** The language to use now: a language, null (follow the company default) or 'keep' (leave what is set here alone). */
  lang: Lang | null | 'keep';
  /** Save this on the account (null = "company default"), or nothing. */
  push: { value: Lang | null } | null;
  /** Whether the person has now been asked about language, so the first-run prompt is not shown again. */
  asked: boolean;
};

/**
 * What to do when the signed-in person's account is known. The account wins:
 *  1. it holds a language: use it;
 *  2. it holds a row with no language (they chose "company default"): follow the company, and do not ask again;
 *  3. it holds nothing but this browser has a choice (made before accounts could store it): keep it and save it;
 *  4. nothing anywhere, but this browser already asked: save "company default" so other devices do not ask;
 *  5. nothing anywhere and never asked: leave things alone, the first-run prompt will ask.
 */
export function planAccountSync(account: Lang | null, accountAsked: boolean, local: Lang | null, localAsked: boolean): AccountSync {
  if (account) return { lang: account, push: null, asked: true };
  if (accountAsked) return { lang: null, push: null, asked: true };
  if (local) return { lang: 'keep', push: { value: local }, asked: true };
  if (localAsked) return { lang: 'keep', push: { value: null }, asked: true };
  return { lang: 'keep', push: null, asked: false };
}
type I18n = {
  /** The language in use right now. */
  lang: Lang;
  /** The person's own choice, or null when they follow the company default. */
  personalLang: Lang | null;
  /** The company's language (the default), or null when not known yet. */
  orgLang: Lang | null;
  /** Set or clear (null) the person's own language. */
  setPersonalLang: (l: Lang | null) => void;
  /** Tell the provider the company's default language. Has no effect on a person who chose their own. */
  setOrgLang: (l: Lang | null) => void;
  /** True once the person has been asked about language (chose English, Arabic or the company default). */
  asked: boolean;
  /** True once the account has been checked, so nothing is shown on a guess before then. */
  ready: boolean;
  /** Called once the signed-in person's account language is known. See planAccountSync. */
  syncAccountLang: (language: Lang | null, asked: boolean) => void;
  /** Tells the provider how to save the person's language on their account (null while signed out or in the demo). */
  setAccountSaver: (save: ((l: Lang | null) => Promise<void>) | null) => void;
  t: (text: string) => string;
};
const Ctx = createContext<I18n>({ lang: 'en', personalLang: null, orgLang: null, asked: false, ready: false, setPersonalLang: () => {}, setOrgLang: () => {}, syncAccountLang: () => {}, setAccountSaver: () => {}, t: (s) => s });

export function I18nProvider({ children }: { children: ReactNode }) {
  const [personalLang, setPersonalState] = useState<Lang | null>(storedLang);
  const [orgLang, setOrgLang] = useState<Lang | null>(null);
  const [asked, setAsked] = useState<boolean>(() => storedLang() !== null || storedAsked());
  const [ready, setReady] = useState(false);
  const lang: Lang = personalLang ?? orgLang ?? 'en';
  currentLang = lang;
  const saver = useRef<((l: Lang | null) => Promise<void>) | null>(null);
  const remember = useCallback((l: Lang | null) => {
    try {
      if (l) localStorage.setItem(KEY, l);
      else localStorage.removeItem(KEY);
    } catch {
      /* storage blocked: the choice lasts for this visit only */
    }
  }, []);
  const setPersonalLang = useCallback((l: Lang | null) => {
    setPersonalState(l);
    remember(l);
    setAsked(true);
    try {
      localStorage.setItem(ASKED_KEY, '1');
    } catch {
      /* storage blocked */
    }
    // Save on the account too. A failed save never undoes the choice: it still applies here and is retried at the next sign-in.
    void saver.current?.(l).catch(() => {});
  }, [remember]);
  const setAccountSaver = useCallback((save: ((l: Lang | null) => Promise<void>) | null) => {
    saver.current = save;
  }, []);
  const syncAccountLang = useCallback((account: Lang | null, accountAsked: boolean) => {
    const plan = planAccountSync(account, accountAsked, storedLang(), storedAsked());
    if (plan.lang !== 'keep') {
      setPersonalState(plan.lang);
      remember(plan.lang);
    }
    if (plan.asked) {
      setAsked(true);
      try {
        localStorage.setItem(ASKED_KEY, '1');
      } catch {
        /* storage blocked */
      }
    }
    // chosen in this browser before accounts could store it (or asked here already): save it now
    if (plan.push) void saver.current?.(plan.push.value).catch(() => {});
    setReady(true);
  }, [remember]);
  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
  }, [lang]);
  const value = useMemo<I18n>(
    () => ({ lang, personalLang, orgLang, asked, ready, setPersonalLang, setOrgLang, syncAccountLang, setAccountSaver, t: (s) => (lang === 'ar' ? (AR[s] ?? s) : s) }),
    [lang, personalLang, orgLang, asked, ready, setPersonalLang, syncAccountLang, setAccountSaver],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useI18n = () => useContext(Ctx);
