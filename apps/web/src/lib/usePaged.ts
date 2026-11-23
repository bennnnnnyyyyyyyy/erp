import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api';
import { pageUrl } from './pageUrl';

// A long list read one page at a time (UX audit 20 Nov: lists stopped at 200 or 500 rows with no way to see older ones). The first
// page loads on mount; more() asks the API for the next page with ?offset= (apps/api/src/lib/paging.ts) and adds it at the end.
// hasMore is true while the last page came back full. `size` must match the page size of the API route.

export type Paged<T> = {
  data: T[] | null;
  error: string | null;
  loading: boolean;
  hasMore: boolean;
  more: () => void;
  reload: () => void;
};


export function usePaged<T>(path: string, size: number, load: (url: string) => Promise<T[]> = (url) => api<T[]>(url)): Paged<T> {
  const [data, setData] = useState<T[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const [tick, setTick] = useState(0);
  const run = useRef(0);

  useEffect(() => {
    const id = ++run.current;
    setLoading(true);
    load(path)
      .then((rows) => {
        if (id !== run.current) return;
        setData(rows);
        setHasMore(rows.length >= size);
        setError(null);
      })
      .catch((e: Error) => id === run.current && setError(e.message))
      .finally(() => id === run.current && setLoading(false));
    // `load` is usually inline; reloading is explicit (reload, or a new path).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, size, tick]);

  const more = useCallback(() => {
    if (!data || loading) return;
    const id = run.current;
    setLoading(true);
    load(pageUrl(path, data.length))
      .then((rows) => {
        if (id !== run.current) return;
        setData((d) => [...(d ?? []), ...rows]);
        setHasMore(rows.length >= size);
      })
      .catch((e: Error) => id === run.current && setError(e.message))
      .finally(() => id === run.current && setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, loading, path, size]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data, error, loading, hasMore, more, reload };
}
