import { useEffect, useState } from 'react';

// Screens being decided (new UI, brief v2): a screen built in 2 or 3 versions reads which one to show from the Design Lab, which writes
// data-d-<key> on <html> (dev server only). In a real build the attribute is never set, so the fallback shows. Once Ben has picked, the
// losing versions and the call to this hook are removed from that screen.
export function useLabChoice<T extends string>(key: string, options: readonly T[], fallback: T): T {
  const read = (): T => {
    const v = document.documentElement.getAttribute(`data-d-${key}`);
    return (options as readonly string[]).includes(v ?? '') ? (v as T) : fallback;
  };
  const [value, setValue] = useState<T>(read);
  useEffect(() => {
    const obs = new MutationObserver(() => setValue(read()));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: [`data-d-${key}`] });
    setValue(read());
    return () => obs.disconnect();
    // biome-ignore lint/correctness/useExhaustiveDependencies: read() only depends on key, options and fallback, which never change for a screen
  }, [key]);
  return value;
}
