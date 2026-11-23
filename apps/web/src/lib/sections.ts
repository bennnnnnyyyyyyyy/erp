import type { AppDef, AppPage } from '../modules/registry';

// The new menu (UX plan: about 6 sections; new UI plan 23 Nov 2026). A section groups apps; its pages are the apps' menu pages. It is
// built from visibleApps(session), so a module that is switched off or a page the person may not open never appears. Hiding a menu
// item never gives or takes away access: the API and the database still check every request.
export type SectionKey = 'home' | 'sell' | 'buy' | 'stock' | 'money' | 'settings';
export const SECTION_DEFS: { key: SectionKey; label: string; apps: string[] }[] = [
  { key: 'home', label: 'Home', apps: ['tasks', 'messaging', 'alerts', 'start', 'guide'] },
  { key: 'sell', label: 'Sell', apps: ['sales'] },
  { key: 'buy', label: 'Buy', apps: ['purchasing'] },
  { key: 'stock', label: 'Stock', apps: ['inventory'] },
  { key: 'money', label: 'Money', apps: ['finance', 'treasury', 'accounting'] },
  { key: 'settings', label: 'Settings', apps: ['settings', 'hr'] },
];

export type SectionLink = { app: AppDef; page: AppPage; to: string };
export type Section = { key: SectionKey; label: string; groups: { app: AppDef; links: SectionLink[] }[]; first: string };

export function buildSections(apps: AppDef[]): Section[] {
  const out: Section[] = [];
  for (const def of SECTION_DEFS) {
    const groups = def.apps
      .map((k) => apps.find((a) => a.key === k))
      .filter((a): a is AppDef => !!a)
      .map((app) => ({ app, links: app.pages.filter((p) => p.nav !== false).map((page) => ({ app, page, to: app.basePath + page.path || '/' })) }))
      .filter((g) => g.links.length > 0);
    if (def.key !== 'home' && groups.length === 0) continue;
    out.push({ key: def.key, label: def.label, groups, first: def.key === 'home' ? '/' : (groups[0]?.links[0]?.to ?? '/') });
  }
  // Any app not placed above (a new module) is never lost: it goes under Settings until it gets a section.
  const placed = new Set(SECTION_DEFS.flatMap((d) => d.apps));
  const rest = apps.filter((a) => !placed.has(a.key) && a.pages.some((p) => p.nav !== false));
  if (rest.length) {
    const settings = out.find((s) => s.key === 'settings');
    const extra = rest.map((app) => ({ app, links: app.pages.filter((p) => p.nav !== false).map((page) => ({ app, page, to: app.basePath + page.path || '/' })) }));
    if (settings) settings.groups.push(...extra);
    else out.push({ key: 'settings', label: 'Settings', groups: extra, first: extra[0]?.links[0]?.to ?? '/' });
  }
  return out;
}

/** Which section the current app belongs to. */
export function sectionOf(appKey: string | undefined, sections: Section[]): SectionKey {
  if (!appKey) return 'home';
  return sections.find((s) => s.groups.some((g) => g.app.key === appKey))?.key ?? 'home';
}

/** Every page a person can open, for the search box and the "All pages" map. */
export const allLinks = (sections: Section[]): SectionLink[] => sections.flatMap((s) => s.groups.flatMap((g) => g.links));

// Recent pages, kept on this device (per person). Pinned pages, the same. Both are conveniences only.
const RECENT = 'erp.recent.v1';
const PINNED = 'erp.pinned.v1';
const read = (k: string): string[] => {
  try {
    const v = JSON.parse(localStorage.getItem(k) ?? '[]');
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
};
const write = (k: string, v: string[]) => {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {
    /* private mode: no memory, no harm */
  }
};
export const recentPaths = () => read(RECENT);
export const pushRecent = (path: string) => write(RECENT, [path, ...read(RECENT).filter((p) => p !== path)].slice(0, 8));
export const pinnedPaths = () => read(PINNED);
export const togglePinned = (path: string) => {
  const cur = read(PINNED);
  write(PINNED, cur.includes(path) ? cur.filter((p) => p !== path) : [...cur, path].slice(0, 12));
};
