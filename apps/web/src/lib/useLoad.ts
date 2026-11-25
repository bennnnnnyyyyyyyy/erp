import { useCallback, useEffect, useState } from 'react';

export type Loaded<T> = { data: T | null; error: string | null; loading: boolean; reload: () => void; setData: (d: T) => void };

/** Runs `load` on mount (and when `reload` is called), tracking loading and error state. */
export function useLoad<T>(load: () => Promise<T>): Loaded<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let live = true;
    setLoading(true);
    load()
      .then((d) => {
        if (!live) return;
        setData(d);
        setError(null);
      })
      .catch((e: Error) => live && setError(e.message))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
    // `load` is usually an inline closure; reloading is explicit through `reload`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data, error, loading, reload, setData };
}

/**
 * The first error among a screen's loads, and a retry that reloads the ones that failed (input and speed audit, 25 Nov 2026: a screen
 * whose second load failed showed its skeleton for ever). Use as `<Loading {...failed(a, b)} />`.
 */
export function failed(...loads: { error: string | null; reload: () => void }[]): { error: string | null; onRetry?: () => void } {
  const bad = loads.filter((l) => l.error);
  return bad.length === 0 ? { error: null } : { error: bad[0]?.error ?? null, onRetry: () => { for (const l of bad) l.reload(); } };
}
