import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

// Light, dark, or follow the system. The choice is kept in this browser; the `dark` class on <html> drives the colours.
export type ThemeChoice = 'light' | 'dark' | 'system';

const KEY = 'erp.theme';

function stored(): ThemeChoice {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

const systemDark = () => window.matchMedia('(prefers-color-scheme: dark)').matches;

type Theme = { choice: ThemeChoice; dark: boolean; setChoice: (c: ThemeChoice) => void; toggle: () => void };
const Ctx = createContext<Theme>({ choice: 'system', dark: false, setChoice: () => {}, toggle: () => {} });

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [choice, setChoiceState] = useState<ThemeChoice>(stored);
  const [sys, setSys] = useState(systemDark);
  const dark = choice === 'dark' || (choice === 'system' && sys);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const on = () => setSys(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
  }, [dark]);

  const setChoice = useCallback((c: ThemeChoice) => {
    setChoiceState(c);
    try {
      if (c === 'system') localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, c);
    } catch {
      /* storage blocked: the choice lasts for this visit only */
    }
  }, []);
  const toggle = useCallback(() => setChoice(dark ? 'light' : 'dark'), [dark, setChoice]);
  const value = useMemo(() => ({ choice, dark, setChoice, toggle }), [choice, dark, setChoice, toggle]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useTheme = () => useContext(Ctx);
