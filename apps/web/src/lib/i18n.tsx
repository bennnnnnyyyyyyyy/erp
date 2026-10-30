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
};

/** How many UI strings have an Arabic text. Shown honestly in the language menu so nobody assumes the whole app is translated. */
export const arabicStringCount = Object.keys(AR).length;

const KEY = 'erp.lang';

function initialLang(): Lang {
  try {
    return localStorage.getItem(KEY) === 'ar' ? 'ar' : 'en';
  } catch {
    return 'en';
  }
}

type I18n = { lang: Lang; setLang: (l: Lang) => void; t: (text: string) => string };
const Ctx = createContext<I18n>({ lang: 'en', setLang: () => {}, t: (s) => s });

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initialLang);
  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    try {
      localStorage.setItem(KEY, l);
    } catch {
      /* storage blocked: the choice lasts for this visit only */
    }
  }, []);
  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
  }, [lang]);
  const value = useMemo<I18n>(() => ({ lang, setLang, t: (s) => (lang === 'ar' ? (AR[s] ?? s) : s) }), [lang, setLang]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useI18n = () => useContext(Ctx);
