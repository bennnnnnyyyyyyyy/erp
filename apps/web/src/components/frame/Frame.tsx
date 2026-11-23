import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { BRAND } from '../../lib/brand';
import { tr } from '../../lib/i18n';
import { Link, navigate } from '../../lib/router';
import { allLinks, pinnedPaths, recentPaths, togglePinned, type Section, type SectionKey, type SectionLink } from '../../lib/sections';
import { AppIcon, PageIcon } from '../icons';
import './frame.css';

// The new app frame (new UI plan, 23 Nov 2026; Dynamics 365 way of working). Three versions being decided by Ben and Grant, switched in
// the Design Lab ("Screens being decided > Menu"):
//   A  Areas on top (Business Central): the app bar, then a row of the 6 sections; each opens a panel of its pages.
//   B  Left menu (Dynamics Finance / Supply Chain): Home, Recent, Pinned, then the 6 sections with their pages; folds to icons.
//   C  Search first: a big search in the app bar, a slim rail of the 6 sections; each opens a panel of its pages.
// Every version has the same app bar (logo, one search for every page, the company, the person) and keyboard search (Ctrl+K).
export type FrameVersion = 'A' | 'B' | 'C';

const HOME_ICON = (
  <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 11l9-7 9 7" />
    <path d="M5 10v10h14V10" />
  </svg>
);
const SECTION_APP: Record<SectionKey, string> = { home: '', sell: 'sales', buy: 'purchasing', stock: 'inventory', money: 'finance', settings: 'settings' };
export function SectionIcon({ k }: { k: SectionKey }) {
  return k === 'home' ? HOME_ICON : <AppIcon appKey={SECTION_APP[k]} name={k} />;
}

/** One search for every page the person can open (Ctrl+K or / from anywhere). Records come later with the search endpoint. */
function PageSearch({ sections, big = false }: { sections: Section[]; big?: boolean }) {
  const { t } = { t: tr };
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();
  const links = useMemo(() => allLinks(sections), [sections]);
  const sectionLabel = (l: SectionLink) => t(sections.find((s) => s.groups.some((g) => g.app === l.app))?.label ?? '');
  const hits = useMemo(() => {
    const s = q.trim().toLowerCase();
    const all = links.map((l) => ({ l, label: t(l.page.label), app: t(l.app.name) }));
    return (s ? all.filter((x) => x.label.toLowerCase().includes(s) || x.app.toLowerCase().includes(s) || x.l.page.label.toLowerCase().includes(s)) : all).slice(0, 8);
  }, [q, links, t]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement)?.closest('input, textarea, select, [contenteditable]');
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        input.current?.focus();
      } else if (e.key === '/' && !typing) {
        e.preventDefault();
        input.current?.focus();
      }
    };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, []);
  const go = (to: string) => {
    setOpen(false);
    setQ('');
    input.current?.blur();
    navigate(to);
  };
  return (
    <div className={big ? 'fr-search fr-search-big' : 'fr-search'}>
      <svg className="fr-search-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
      <input
        ref={input}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-label={tr('Search for a page')}
        placeholder={big ? tr('What do you want to do? Type a page, for example "invoice"') : tr('Search for a page')}
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, hits.length - 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
          else if (e.key === 'Enter' && hits[active]) { e.preventDefault(); go(hits[active].l.to); }
          else if (e.key === 'Escape') { setOpen(false); input.current?.blur(); }
        }}
      />
      <span className="fr-kbd" aria-hidden="true">Ctrl K</span>
      {open && hits.length > 0 && (
        <ul className="fr-hits" id={listId} role="listbox">
          {hits.map((h, i) => (
            <li key={h.l.to} role="option" aria-selected={i === active} onMouseDown={(e) => { e.preventDefault(); go(h.l.to); }} onMouseEnter={() => setActive(i)}>
              <span className="fr-hit-icon"><PageIcon appKey={h.l.app.key} path={h.l.page.path} /></span>
              <span className="fr-hit-label">{h.label}</span>
              <span className="fr-hit-where">{sectionLabel(h.l)} · {h.app}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** The pages of one section, grouped by app (used by the panels in A and C and the "All pages" map). */
function SectionPanel({ section, current, onPick }: { section: Section; current: string; onPick: () => void }) {
  return (
    <div className="fr-panel-groups">
      {section.groups.map((g) => (
        <div key={g.app.key} className="fr-panel-group">
          <p className="fr-panel-head">{tr(g.app.name)}</p>
          {g.links.map((l) => (
            <Link key={l.to} to={l.to} className={l.to === current ? 'fr-plink active' : 'fr-plink'} onClick={onPick}>
              <span className="fr-plink-icon"><PageIcon appKey={l.app.key} path={l.page.path} /></span>
              {tr(l.page.label)}
            </Link>
          ))}
        </div>
      ))}
    </div>
  );
}

/** Closes an open panel on Escape or a click outside. */
function useDismiss(open: boolean, close: () => void, ref: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && close();
    const key = (e: KeyboardEvent) => e.key === 'Escape' && close();
    document.addEventListener('mousedown', down);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('mousedown', down);
      document.removeEventListener('keydown', key);
    };
  }, [open, close, ref]);
}

type FrameProps = {
  version: FrameVersion;
  sections: Section[];
  current: SectionKey;
  path: string;
  /** Company logo and name, the light/dark switch, the bell, the account menu: the same in every version. */
  end: ReactNode;
  children: ReactNode;
};

function AppBar({ sections, end, big, onMenu, menuOpen }: { sections: Section[]; end: ReactNode; big?: boolean; onMenu: () => void; menuOpen: boolean }) {
  return (
    <header className="fr-bar">
      <button type="button" className="fr-menu-btn" onClick={onMenu} aria-expanded={menuOpen} aria-label={tr('Menu')}>☰</button>
      <Link to="/" className="fr-brand" title={BRAND.name}>
        <img src={BRAND.logo} alt={BRAND.name} />
        <span aria-hidden="true">{BRAND.suffix}</span>
      </Link>
      <div className={big ? 'fr-bar-mid fr-bar-mid-big' : 'fr-bar-mid'}><PageSearch sections={sections} big={big} /></div>
      <div className="fr-bar-end">{end}</div>
    </header>
  );
}

/* A: areas on top */
function AreasTop({ sections, current, path, onPick }: { sections: Section[]; current: SectionKey; path: string; onPick: () => void }) {
  const [open, setOpen] = useState<SectionKey | null>(null);
  const ref = useRef<HTMLElement>(null);
  useDismiss(open !== null, () => setOpen(null), ref);
  const cur = sections.find((s) => s.key === current);
  const quick = cur && cur.key !== 'home' ? cur.groups[0]?.links.slice(0, 7) ?? [] : [];
  return (
    <nav className="fr-areas" ref={ref} aria-label={tr('Menu')}>
      <div className="fr-areas-row">
        {sections.map((s) =>
          s.key === 'home' ? (
            <Link key={s.key} to="/" className={current === 'home' ? 'fr-area active' : 'fr-area'}>{tr(s.label)}</Link>
          ) : (
            <button key={s.key} type="button" className={current === s.key ? 'fr-area active' : 'fr-area'} aria-expanded={open === s.key} onClick={() => setOpen(open === s.key ? null : s.key)}>
              {tr(s.label)} <span className="fr-caret" aria-hidden="true">▾</span>
            </button>
          ),
        )}
      </div>
      {quick.length > 0 && (
        <div className="fr-quick">
          {quick.map((l) => (
            <Link key={l.to} to={l.to} className={l.to === path ? 'fr-qlink active' : 'fr-qlink'}>{tr(l.page.label)}</Link>
          ))}
        </div>
      )}
      {open && (
        <div className="fr-drop">
          <SectionPanel section={sections.find((s) => s.key === open)!} current={path} onPick={() => { setOpen(null); onPick(); }} />
        </div>
      )}
    </nav>
  );
}

/* B: left menu */
function MenuItem({ l, path, folded, pins, onPins }: { l: SectionLink; path: string; folded: boolean; pins: string[]; onPins: (p: string[]) => void }) {
  return (
    <span className="fr-li-row">
      <Link to={l.to} className={l.to === path ? 'fr-li active' : 'fr-li'} aria-current={l.to === path ? 'page' : undefined} title={folded ? tr(l.page.label) : undefined}>
        <span className="fr-li-icon"><PageIcon appKey={l.app.key} path={l.page.path} /></span>
        <span className="fr-li-text">{tr(l.page.label)}</span>
      </Link>
      {!folded && (
        <button type="button" className={pins.includes(l.to) ? 'fr-pin on' : 'fr-pin'} aria-pressed={pins.includes(l.to)} aria-label={tr('Pin to the menu')} onClick={() => { togglePinned(l.to); onPins(pinnedPaths()); }}>★</button>
      )}
    </span>
  );
}

function LeftMenu({ sections, current, path, folded, onFold }: { sections: Section[]; current: SectionKey; path: string; folded: boolean; onFold: () => void }) {
  const links = useMemo(() => allLinks(sections), [sections]);
  const byPath = (p: string) => links.find((l) => l.to === p);
  const [openKey, setOpenKey] = useState<SectionKey | null>(current);
  const [pins, setPins] = useState(pinnedPaths);
  useEffect(() => setOpenKey(current), [current]);
  const recent = recentPaths().map(byPath).filter((l): l is SectionLink => !!l).slice(0, 5);
  const pinned = pins.map(byPath).filter((l): l is SectionLink => !!l);
  return (
    <nav className={folded ? 'fr-left folded' : 'fr-left'} aria-label={tr('Menu')}>
      <button type="button" className="fr-fold" onClick={onFold} aria-label={folded ? tr('Open the menu') : tr('Fold the menu')}>{folded ? '»' : '«'}</button>
      <Link to="/" className={path === '/' || path === '' ? 'fr-li active' : 'fr-li'}>
        <span className="fr-li-icon">{HOME_ICON}</span><span className="fr-li-text">{tr('Home')}</span>
      </Link>
      {!folded && pinned.length > 0 && (
        <div className="fr-lgroup"><p className="fr-lhead">{tr('Pinned')}</p>{pinned.map((l) => <MenuItem path={path} folded={folded} pins={pins} onPins={setPins} key={`p${l.to}`} l={l} />)}</div>
      )}
      {!folded && recent.length > 0 && (
        <div className="fr-lgroup"><p className="fr-lhead">{tr('Recent')}</p>{recent.map((l) => <MenuItem path={path} folded={folded} pins={pins} onPins={setPins} key={`r${l.to}`} l={l} />)}</div>
      )}
      <div className="fr-lgroup">
        {!folded && <p className="fr-lhead">{tr('Sections')}</p>}
        {sections.filter((s) => s.key !== 'home').map((s) => (
          <div key={s.key} className="fr-lsec">
            <button type="button" className={current === s.key ? 'fr-lsec-btn active' : 'fr-lsec-btn'} aria-expanded={openKey === s.key} title={folded ? tr(s.label) : undefined}
              onClick={() => (folded ? navigate(s.first) : setOpenKey(openKey === s.key ? null : s.key))}>
              <span className="fr-li-icon"><SectionIcon k={s.key} /></span>
              <span className="fr-li-text">{tr(s.label)}</span>
              {!folded && <span className="fr-caret" aria-hidden="true">{openKey === s.key ? '▾' : '▸'}</span>}
            </button>
            {!folded && openKey === s.key && (
              <div className="fr-lsec-pages">
                {s.groups.map((g) => (
                  <div key={g.app.key}>
                    {s.groups.length > 1 && <p className="fr-lsub">{tr(g.app.name)}</p>}
                    {g.links.map((l) => <MenuItem path={path} folded={folded} pins={pins} onPins={setPins} key={l.to} l={l} />)}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </nav>
  );
}

/* C: rail + search first */
function Rail({ sections, current, path }: { sections: Section[]; current: SectionKey; path: string }) {
  const [open, setOpen] = useState<SectionKey | null>(null);
  const ref = useRef<HTMLElement>(null);
  useDismiss(open !== null, () => setOpen(null), ref);
  const sec = sections.find((s) => s.key === open);
  return (
    <nav className="fr-rail" ref={ref} aria-label={tr('Menu')}>
      {sections.map((s) => (
        <button key={s.key} type="button" className={current === s.key ? 'fr-rail-btn active' : 'fr-rail-btn'} aria-expanded={s.key === 'home' ? undefined : open === s.key}
          onClick={() => (s.key === 'home' ? (setOpen(null), navigate('/')) : setOpen(open === s.key ? null : s.key))}>
          <span className="fr-rail-icon"><SectionIcon k={s.key} /></span>
          <span className="fr-rail-text">{tr(s.label)}</span>
        </button>
      ))}
      {sec && (
        <div className="fr-flyout">
          <p className="fr-flyout-title">{tr(sec.label)}</p>
          <SectionPanel section={sec} current={path} onPick={() => setOpen(null)} />
        </div>
      )}
    </nav>
  );
}

export function Frame({ version, sections, current, path, end, children }: FrameProps) {
  const [drawer, setDrawer] = useState(false);
  const [folded, setFolded] = useState(false);
  useEffect(() => setDrawer(false), [path]);
  return (
    <div className={`fr fr-${version.toLowerCase()}${drawer ? ' fr-drawer-open' : ''}${folded ? ' fr-folded' : ''}`}>
      <AppBar sections={sections} end={end} big={version === 'C'} onMenu={() => setDrawer((d) => !d)} menuOpen={drawer} />
      {version === 'A' && <AreasTop sections={sections} current={current} path={path} onPick={() => setDrawer(false)} />}
      {version === 'B' && <LeftMenu sections={sections} current={current} path={path} folded={folded} onFold={() => setFolded((f) => !f)} />}
      {version === 'C' && <Rail sections={sections} current={current} path={path} />}
      <div className="fr-main">{children}</div>
    </div>
  );
}
