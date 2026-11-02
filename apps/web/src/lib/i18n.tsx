import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

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

// A person's own choice (kept in this browser) wins; with none, the company's language applies; with neither, English.
// Nothing forces a language: the company language is only a default.
function storedLang(): Lang | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'ar' || v === 'en' ? v : null;
  } catch {
    return null;
  }
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
  t: (text: string) => string;
};
const Ctx = createContext<I18n>({ lang: 'en', personalLang: null, orgLang: null, setPersonalLang: () => {}, setOrgLang: () => {}, t: (s) => s });

export function I18nProvider({ children }: { children: ReactNode }) {
  const [personalLang, setPersonalState] = useState<Lang | null>(storedLang);
  const [orgLang, setOrgLang] = useState<Lang | null>(null);
  const lang: Lang = personalLang ?? orgLang ?? 'en';
  const setPersonalLang = useCallback((l: Lang | null) => {
    setPersonalState(l);
    try {
      if (l) localStorage.setItem(KEY, l);
      else localStorage.removeItem(KEY);
    } catch {
      /* storage blocked: the choice lasts for this visit only */
    }
  }, []);
  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
  }, [lang]);
  const value = useMemo<I18n>(
    () => ({ lang, personalLang, orgLang, setPersonalLang, setOrgLang, t: (s) => (lang === 'ar' ? (AR[s] ?? s) : s) }),
    [lang, personalLang, orgLang, setPersonalLang],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useI18n = () => useContext(Ctx);
