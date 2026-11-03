import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

// English / Arabic. The English text itself is the key, so a missing translation shows English and never a blank or a code.
// The Arabic below is a MACHINE DRAFT for the shell only and needs review by a native speaker before it is shown to customers.

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

/** How many UI strings have an Arabic text. Shown honestly in the language menu so nobody assumes the whole app is translated. */
export const arabicStringCount = Object.keys(AR).length;

const KEY = 'erp.lang';

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

/**
 * What to do when the signed-in person's saved account language becomes known. The account wins: if it holds a language, use it here.
 * If it holds none but this browser has a choice, keep the choice and save it to the account. With neither, do nothing.
 */
export function planAccountSync(account: Lang | null, local: Lang | null): { apply: Lang | null; push: Lang | null } {
  if (account) return { apply: account, push: null };
  return { apply: null, push: local };
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
  /** Called once the signed-in person's saved account language is known (null = none saved). The account wins; a browser-only choice is saved to the account. */
  syncAccountLang: (l: Lang | null) => void;
  /** Tells the provider how to save the person's language on their account (null while signed out or in the demo). */
  setAccountSaver: (save: ((l: Lang | null) => Promise<void>) | null) => void;
  t: (text: string) => string;
};
const Ctx = createContext<I18n>({ lang: 'en', personalLang: null, orgLang: null, setPersonalLang: () => {}, setOrgLang: () => {}, syncAccountLang: () => {}, setAccountSaver: () => {}, t: (s) => s });

export function I18nProvider({ children }: { children: ReactNode }) {
  const [personalLang, setPersonalState] = useState<Lang | null>(storedLang);
  const [orgLang, setOrgLang] = useState<Lang | null>(null);
  const lang: Lang = personalLang ?? orgLang ?? 'en';
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
    // Save on the account too. A failed save never undoes the choice: it still applies here and is retried at the next sign-in.
    void saver.current?.(l).catch(() => {});
  }, [remember]);
  const setAccountSaver = useCallback((save: ((l: Lang | null) => Promise<void>) | null) => {
    saver.current = save;
  }, []);
  const syncAccountLang = useCallback((account: Lang | null) => {
    const plan = planAccountSync(account, storedLang());
    if (plan.apply) {
      setPersonalState(plan.apply);
      remember(plan.apply);
    }
    // chosen in this browser before accounts could store it: save it now
    if (plan.push) void saver.current?.(plan.push).catch(() => {});
  }, [remember]);
  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
  }, [lang]);
  const value = useMemo<I18n>(
    () => ({ lang, personalLang, orgLang, setPersonalLang, setOrgLang, syncAccountLang, setAccountSaver, t: (s) => (lang === 'ar' ? (AR[s] ?? s) : s) }),
    [lang, personalLang, orgLang, setPersonalLang, syncAccountLang, setAccountSaver],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useI18n = () => useContext(Ctx);
