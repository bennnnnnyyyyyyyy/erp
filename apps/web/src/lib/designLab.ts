// Design Lab (dev server only): every visual decision as an option, applied live as data attributes and CSS variables on <html>.
// Choices are kept in localStorage so they survive reloads. Once Ben has chosen, the winners are baked into theme.css / styles.css.
// The CSS for each option is in src/design-lab.css. Not part of the product: it is never bundled in a production build (main.tsx
// only imports it when import.meta.env.DEV is true), so its labels are intentionally plain English.

export type Choice = { value: string; label: string; hint?: string; swatch?: [string, string, string] };
export type Group = {
  key: string; section: string; label: string; help?: string;
  kind?: 'chips' | 'swatches' | 'select' | 'range';
  options: Choice[]; default: string;
  /** range groups: '' means "off" (the theme's own value is used) */
  min?: number; max?: number; step?: number; unit?: string;
};

type FontDef = { value: string; label: string; stack: string; google?: string; arabic: boolean };
export const FONTS: FontDef[] = [
  { value: 'plex', label: 'IBM Plex Sans Arabic (current)', stack: "'IBM Plex Sans Arabic'", arabic: true },
  { value: 'readex', label: 'Readex Pro: friendly, Arabic + Latin', stack: "'Readex Pro'", google: 'Readex+Pro:wght@300..700', arabic: true },
  { value: 'cairo', label: 'Cairo: clean, very common in Egypt', stack: "'Cairo'", google: 'Cairo:wght@400..800', arabic: true },
  { value: 'tajawal', label: 'Tajawal: compact, modern', stack: "'Tajawal'", google: 'Tajawal:wght@400;500;700', arabic: true },
  { value: 'almarai', label: 'Almarai: soft, rounded feel', stack: "'Almarai'", google: 'Almarai:wght@400;700;800', arabic: true },
  { value: 'kufi', label: 'Noto Kufi Arabic: geometric', stack: "'Noto Kufi Arabic'", google: 'Noto+Kufi+Arabic:wght@400..700', arabic: true },
  { value: 'ibmarabic', label: 'IBM Plex Sans (Latin) + Arabic', stack: "'IBM Plex Sans'", google: 'IBM+Plex+Sans:wght@400..700', arabic: false },
  { value: 'inter', label: 'Inter (Latin only)', stack: "'Inter'", google: 'Inter:wght@400..700', arabic: false },
  { value: 'manrope', label: 'Manrope (Latin only)', stack: "'Manrope'", google: 'Manrope:wght@400..800', arabic: false },
  { value: 'dmsans', label: 'DM Sans (Latin only)', stack: "'DM Sans'", google: 'DM+Sans:wght@400..700', arabic: false },
  { value: 'jakarta', label: 'Plus Jakarta Sans (Latin only)', stack: "'Plus Jakarta Sans'", google: 'Plus+Jakarta+Sans:wght@400..800', arabic: false },
  { value: 'worksans', label: 'Work Sans (Latin only)', stack: "'Work Sans'", google: 'Work+Sans:wght@400..700', arabic: false },
  { value: 'sora', label: 'Sora: wide, techy (Latin only)', stack: "'Sora'", google: 'Sora:wght@400..700', arabic: false },
  { value: 'fraunces', label: 'Fraunces: warm serif (Latin only)', stack: "'Fraunces'", google: 'Fraunces:wght@400..700', arabic: false },
  { value: 'playfair', label: 'Playfair Display: editorial serif', stack: "'Playfair Display'", google: 'Playfair+Display:wght@400..700', arabic: false },
  { value: 'lora', label: 'Lora: book serif (Latin only)', stack: "'Lora'", google: 'Lora:wght@400..700', arabic: false },
  { value: 'segoe', label: 'Segoe UI (Windows system)', stack: "'Segoe UI'", arabic: true },
  { value: 'tahoma', label: 'Tahoma (system, good Arabic)', stack: "'Tahoma'", arabic: true },
  { value: 'georgia', label: 'Georgia (system serif)', stack: 'Georgia', arabic: false },
  { value: 'mono', label: 'IBM Plex Mono (technical)', stack: "'IBM Plex Mono'", arabic: false },
];
const fontOptions: Choice[] = FONTS.map((f) => ({ value: f.value, label: f.label }));

const c = (value: string, label: string, hint?: string): Choice => (hint ? { value, label, hint } : { value, label });
const range = (key: string, section: string, label: string, min: number, max: number, step: number, unit: string, help?: string): Group =>
  ({ key, section, label, kind: 'range', options: [], default: '', min, max, step, unit, ...(help ? { help } : {}) });

export const GROUPS: Group[] = [
  // ---------- Colour ----------
  { key: 'palette', section: 'Colour', label: 'Palette', kind: 'swatches', default: 'graphite', help: 'Brand colour, accent, background tint and sidebar all follow this. "Custom" uses the four sliders below.', options: [
    { value: 'teal', label: 'Teal + saffron', swatch: ['#0f5a63', '#e3b34a', '#f8f4ea'] },
    { value: 'indigo', label: 'Indigo', swatch: ['#3b3fa6', '#e6a93a', '#f5f5fb'] },
    { value: 'royal', label: 'Royal blue', swatch: ['#1f4fc4', '#f0b43c', '#f3f6fc'] },
    { value: 'emerald', label: 'Emerald', swatch: ['#1c6b4a', '#e4b94f', '#f3f7f1'] },
    { value: 'terracotta', label: 'Terracotta', swatch: ['#a4472a', '#3f9aa0', '#faf3ec'] },
    { value: 'plum', label: 'Plum', swatch: ['#6d2f6f', '#e2b24a', '#f8f3f8'] },
    { value: 'rose', label: 'Rose', swatch: ['#b23a5a', '#e0b04a', '#fbf3f4'] },
    { value: 'graphite', label: 'Graphite', swatch: ['#2f3a45', '#e0a63c', '#f4f5f6'] },
    { value: 'mono', label: 'Black & white', swatch: ['#1a1a1a', '#8a8a8a', '#fafafa'] },
    { value: 'custom', label: 'Custom (sliders)', swatch: ['#5a6c8a', '#c9a24a', '#f4f4f6'] },
  ] },
  range('lhue', 'Colour', 'Custom: brand hue', 0, 360, 1, '°', 'Only used when Palette = Custom.'),
  range('lchroma', 'Colour', 'Custom: brand intensity', 0, 0.22, 0.005, '', 'Only used when Palette = Custom. 0 is grey.'),
  range('lbg', 'Colour', 'Custom: background tint hue', 0, 360, 1, '°', 'Only used when Palette = Custom.'),
  range('lacc', 'Colour', 'Custom: accent hue', 0, 360, 1, '°', 'The highlight colour (active marker, warnings). Only when Palette = Custom.'),
  { key: 'appcolor', section: 'Colour', label: 'App icon colours', default: 'app', help: '"By app" uses a fixed teal/saffron family per app. "Brand" follows the palette.', options: [c('app', 'By app'), c('brand', 'Brand colour')] },
  { key: 'bg', section: 'Colour', label: 'Page background', default: 'glow', options: [c('plain', 'Plain'), c('glow', 'Soft glow'), c('dots', 'Dot grid'), c('lattice', 'Star lattice'), c('grain', 'Paper grain')] },
  { key: 'border', section: 'Colour', label: 'Border strength', default: 'hairline', options: [c('none', 'None (shadow only)'), c('hairline', 'Hairline'), c('strong', 'Strong')] },
  { key: 'selection', section: 'Colour', label: 'Text selection colour', default: 'default', options: [c('default', 'Browser'), c('brand', 'Brand'), c('saffron', 'Accent')] },

  // ---------- Type ----------
  { key: 'hfont', section: 'Type', label: 'Headings font', kind: 'select', default: 'plex', help: 'Google fonts load from the internet in this dev tool only. Latin-only fonts fall back to Plex for Arabic.', options: fontOptions },
  { key: 'bfont', section: 'Type', label: 'Body font', kind: 'select', default: 'plex', options: fontOptions },
  { key: 'hsize', section: 'Type', label: 'Heading size', default: 'xl', options: [c('small', 'Small'), c('normal', 'Normal'), c('large', 'Large'), c('xl', 'Extra large')] },
  { key: 'hweight', section: 'Type', label: 'Heading weight', default: 'normal', options: [c('light', 'Medium'), c('normal', 'Semi-bold'), c('bold', 'Bold')] },
  { key: 'tsize', section: 'Type', label: 'Text size', default: 'large', options: [c('small', '14px'), c('normal', '15px'), c('large', '16px'), c('xl', '17px')] },
  range('fspx', 'Type', 'Exact text size (px)', 13, 20, 0.5, 'px', 'Overrides Text size when on.'),
  { key: 'lheight', section: 'Type', label: 'Line spacing', default: 'normal', options: [c('tight', 'Tight'), c('normal', 'Normal'), c('loose', 'Loose')] },
  { key: 'numfont', section: 'Type', label: 'Numbers in tables and stats', default: 'mono', options: [c('mono', 'Monospace'), c('sans', 'Body font (tabular)')] },
  { key: 'titlealign', section: 'Type', label: 'Page title alignment', default: 'start', options: [c('start', 'Start'), c('center', 'Centered')] },

  // ---------- Shape & depth ----------
  { key: 'radius', section: 'Shape', label: 'Corner radius', default: 'round', options: [c('sharp', 'Sharp'), c('subtle', 'Subtle'), c('round', 'Rounded'), c('soft', 'Very round')] },
  range('rpx', 'Shape', 'Exact corner radius (px)', 0, 32, 1, 'px', 'Overrides Corner radius when on.'),
  { key: 'cards', section: 'Shape', label: 'Card style', default: 'border', options: [c('border', 'Bordered'), c('shadow', 'Floating shadow'), c('flat', 'Flat tint'), c('glass', 'Glass')] },
  { key: 'shadow', section: 'Shape', label: 'Shadow strength', default: 'soft', options: [c('none', 'None'), c('soft', 'Soft'), c('strong', 'Strong')] },
  { key: 'density', section: 'Shape', label: 'Density', default: 'comfy', options: [c('compact', 'Compact'), c('comfy', 'Comfortable'), c('spacious', 'Spacious')] },
  range('rowpad', 'Shape', 'Exact table row height', 0.25, 1.4, 0.05, 'rem', 'Vertical padding of every table cell. Overrides Density for tables.'),
  { key: 'width', section: 'Shape', label: 'Content width', default: 'wide', options: [c('narrow', 'Narrow (1100)'), c('wide', 'Wide (1560)'), c('full', 'Full width')] },
  range('cwpx', 'Shape', 'Exact content width (px)', 800, 2200, 20, 'px', 'Overrides Content width when on.'),
  { key: 'iconw', section: 'Shape', label: 'Icon line weight', default: 'normal', options: [c('thin', 'Thin'), c('normal', 'Normal'), c('bold', 'Bold')] },
  { key: 'avatar', section: 'Shape', label: 'Avatar shape', default: 'circle', options: [c('circle', 'Circle'), c('squircle', 'Rounded square'), c('square', 'Square')] },

  // ---------- Navigation ----------
  { key: 'sidebar', section: 'Navigation', label: 'Sidebar style', default: 'dark', options: [c('dark', 'Dark brand'), c('light', 'Light'), c('paper', 'Same as page'), c('rail', 'Icon rail (narrow)')] },
  { key: 'sbw', section: 'Navigation', label: 'Sidebar width', default: 'normal', options: [c('narrow', 'Narrow'), c('normal', 'Normal'), c('wide', 'Wide')] },
  range('sbwpx', 'Navigation', 'Exact sidebar width (px)', 180, 360, 4, 'px', 'Overrides Sidebar width when on.'),
  { key: 'navactive', section: 'Navigation', label: 'Active page marker', default: 'marker', options: [c('marker', 'Edge marker + tint'), c('pill', 'Solid pill'), c('underline', 'Underline'), c('text', 'Text only')] },
  { key: 'navspace', section: 'Navigation', label: 'Sidebar item spacing', default: 'normal', options: [c('tight', 'Tight'), c('normal', 'Normal'), c('loose', 'Loose')] },
  { key: 'navicons', section: 'Navigation', label: 'Sidebar icons', default: 'on', options: [c('on', 'Show'), c('off', 'Hide')] },
  { key: 'navgroups', section: 'Navigation', label: 'Group headings', default: 'on', options: [c('on', 'Show'), c('off', 'Hide')] },
  { key: 'topbar', section: 'Navigation', label: 'Top bar', default: 'paper', options: [c('paper', 'Paper (blends in)'), c('brand', 'Brand colour'), c('plain', 'White, bordered'), c('clear', 'Transparent')] },
  { key: 'crumbs', section: 'Navigation', label: 'Breadcrumbs', default: 'on', options: [c('on', 'Show'), c('off', 'Hide')] },
  { key: 'logo', section: 'Navigation', label: 'Logo shape', default: 'squircle', options: [c('squircle', 'Rounded square'), c('circle', 'Circle'), c('square', 'Square'), c('sharp', 'Sharp')] },

  // ---------- Home ----------
  { key: 'hero', section: 'Home', label: 'Hero banner', default: 'banner', options: [c('banner', 'Pattern banner'), c('gradient', 'Gradient only'), c('plain', 'Plain text'), c('none', 'No banner (compact)')] },
  { key: 'tiles', section: 'Home', label: 'App tiles', default: 'cards', options: [c('cards', 'Cards'), c('big', 'Big cards'), c('list', 'List rows'), c('minimal', 'Minimal')] },
  { key: 'tilebar', section: 'Home', label: 'Tile accent edge', default: 'top', options: [c('top', 'Top bar'), c('left', 'Side bar'), c('none', 'None')] },

  // ---------- Data screens ----------
  { key: 'stats', section: 'Data', label: 'Stat cards', default: 'edge', options: [c('edge', 'Side edge'), c('top', 'Top edge'), c('plain', 'Plain'), c('filled', 'Filled brand')] },
  { key: 'table', section: 'Data', label: 'Table style', default: 'lined', options: [c('lined', 'Row lines'), c('striped', 'Striped'), c('grid', 'Full grid'), c('airy', 'Borderless')] },
  { key: 'thead', section: 'Data', label: 'Table header', default: 'tint', options: [c('tint', 'Brand tint'), c('plain', 'Plain'), c('dark', 'Dark'), c('line', 'Underline only')] },
  { key: 'rowhover', section: 'Data', label: 'Row hover', default: 'saffron', options: [c('saffron', 'Accent wash'), c('grey', 'Neutral'), c('none', 'None')] },
  { key: 'chips', section: 'Data', label: 'Status chips', default: 'dot', options: [c('dot', 'Dot + soft'), c('solid', 'Solid'), c('outline', 'Outline'), c('text', 'Text only')] },

  // ---------- Controls ----------
  { key: 'btn', section: 'Controls', label: 'Primary buttons', default: 'solid', options: [c('solid', 'Solid'), c('soft', 'Soft tint'), c('outline', 'Outline'), c('gradient', 'Gradient')] },
  { key: 'btnsize', section: 'Controls', label: 'Button size', default: 'normal', options: [c('small', 'Small'), c('normal', 'Normal'), c('large', 'Large')] },
  { key: 'inputs', section: 'Controls', label: 'Inputs', default: 'boxed', options: [c('boxed', 'Boxed'), c('filled', 'Filled'), c('underline', 'Underline')] },
  { key: 'link', section: 'Controls', label: 'Links', default: 'default', options: [c('default', 'Default'), c('plain', 'No underline'), c('accent', 'Accent underline')] },
  { key: 'focus', section: 'Controls', label: 'Keyboard focus ring', default: 'normal', options: [c('normal', 'Normal'), c('thick', 'Thick'), c('glow', 'Soft glow')] },
  { key: 'scroll', section: 'Controls', label: 'Scrollbars', default: 'default', options: [c('default', 'Browser'), c('thin', 'Thin'), c('hidden', 'Hidden')] },
  { key: 'motion', section: 'Controls', label: 'Motion', default: 'full', options: [c('full', 'Full'), c('reduced', 'Subtle'), c('off', 'None')] },
];

export type State = Record<string, string>;
const KEY = 'erp.designLab.v1';
const PRESET_KEY = 'erp.designLab.presets.v1';
const UI_KEY = 'erp.designLab.ui.v1';

export const defaults = (): State => Object.fromEntries(GROUPS.map((g) => [g.key, g.default]));
export const isChanged = (g: Group, s: State) => (s[g.key] ?? g.default) !== g.default;

function sanitize(saved: unknown): State {
  const out: State = {};
  if (saved && typeof saved === 'object') for (const [k, v] of Object.entries(saved as Record<string, unknown>)) if (GROUPS.some((g) => g.key === k) && typeof v === 'string') out[k] = v;
  return out;
}

/** A design shared by link: ?lab=<base64 json>. Applied once at startup, then removed from the address bar. */
function fromUrl(): State | null {
  try {
    const raw = new URLSearchParams(location.search).get('lab');
    if (!raw) return null;
    const parsed = sanitize(JSON.parse(decodeURIComponent(escape(atob(raw)))));
    const url = new URL(location.href); url.searchParams.delete('lab'); history.replaceState(null, '', url.toString());
    return parsed;
  } catch { return null; }
}
export function load(): State {
  const shared = fromUrl();
  if (shared) { const s = { ...defaults(), ...shared }; save(s); return s; }
  try { return { ...defaults(), ...sanitize(JSON.parse(localStorage.getItem(KEY) ?? '{}')) }; } catch { return defaults(); }
}
export function save(s: State) { localStorage.setItem(KEY, JSON.stringify(s)); }
export function shareLink(s: State): string {
  const url = new URL(location.origin + location.pathname);
  url.searchParams.set('lab', btoa(unescape(encodeURIComponent(JSON.stringify(s)))));
  return url.toString();
}
/** Accepts the JSON line from "Copy my choices", a bare JSON object, or a share link. */
export function parseImport(text: string): State | null {
  try {
    const m = text.match(/\{[\s\S]*\}/);
    if (m) return { ...defaults(), ...sanitize(JSON.parse(m[0])) };
    const link = text.match(/[?&]lab=([^&\s]+)/);
    if (link) return { ...defaults(), ...sanitize(JSON.parse(decodeURIComponent(escape(atob(decodeURIComponent(link[1]!)))))) };
  } catch { /* fall through */ }
  return null;
}

export type Saved = { name: string; state: State };
export const loadSaved = (): Saved[] => { try { return JSON.parse(localStorage.getItem(PRESET_KEY) ?? '[]') as Saved[]; } catch { return []; } };
export const storeSaved = (list: Saved[]) => localStorage.setItem(PRESET_KEY, JSON.stringify(list));

export type Ui = { open: boolean; side: 'start' | 'end'; closed: string[]; hidden: boolean };
export const loadUi = (): Ui => { try { return { open: false, side: 'end', closed: [], hidden: false, ...(JSON.parse(localStorage.getItem(UI_KEY) ?? '{}') as Partial<Ui>) }; } catch { return { open: false, side: 'end', closed: [], hidden: false }; } };
export const saveUi = (u: Ui) => localStorage.setItem(UI_KEY, JSON.stringify(u));

export type Preset = { name: string; blurb: string; values: Record<string, string> };
export const PRESETS: Preset[] = [
  { name: 'Ben\'s picks (graphite)', blurb: 'The current baked-in look.', values: {} },
  { name: 'Warm souk', blurb: 'Cream paper, deep teal, saffron.', values: { palette: 'teal', bg: 'glow', hsize: 'normal', tsize: 'normal' } },
  { name: 'Clean fintech', blurb: 'Indigo, light sidebar, shadows, no pattern.', values: { palette: 'indigo', sidebar: 'light', bg: 'plain', cards: 'shadow', hero: 'gradient', thead: 'plain', navactive: 'pill', hfont: 'manrope', bfont: 'inter', topbar: 'plain', border: 'none' } },
  { name: 'Bold & sharp', blurb: 'Graphite, sharp corners, full grid, compact.', values: { palette: 'graphite', radius: 'sharp', density: 'compact', table: 'grid', thead: 'dark', stats: 'filled', border: 'strong', hero: 'plain', bg: 'plain', cards: 'border', logo: 'square', chips: 'solid' } },
  { name: 'Editorial', blurb: 'Serif headings, terracotta, airy.', values: { palette: 'terracotta', hfont: 'fraunces', bg: 'grain', density: 'spacious', table: 'airy', thead: 'line', hero: 'plain', sidebar: 'paper', navactive: 'underline', cards: 'flat', stats: 'plain', tiles: 'minimal', radius: 'subtle' } },
  { name: 'Arabic-first friendly', blurb: 'Readex Pro, emerald, very round, big tiles.', values: { palette: 'emerald', hfont: 'readex', bfont: 'readex', radius: 'soft', tiles: 'big', appcolor: 'brand', density: 'spacious', cards: 'shadow', tsize: 'large' } },
  { name: 'Dense power-user', blurb: 'Icon rail, compact, striped tables.', values: { palette: 'royal', sidebar: 'rail', density: 'compact', table: 'striped', tsize: 'small', hero: 'none', tiles: 'list', width: 'full', bg: 'plain', motion: 'off' } },
  { name: 'Calm & minimal', blurb: 'Light sidebar, no borders, flat tint, thin icons.', values: { palette: 'graphite', sidebar: 'paper', border: 'none', cards: 'flat', bg: 'plain', hero: 'plain', iconw: 'thin', stats: 'plain', thead: 'line', table: 'airy', navactive: 'text' } },
];

function ensureFont(def: FontDef | undefined) {
  if (!def?.google) return;
  const id = `dl-font-${def.value}`;
  if (document.getElementById(id)) return;
  const link = document.createElement('link');
  link.id = id; link.rel = 'stylesheet'; link.href = `https://fonts.googleapis.com/css2?family=${def.google}&display=swap`;
  document.head.appendChild(link);
}
const stackFor = (def: FontDef) => `${def.stack}, 'IBM Plex Sans Arabic', 'Segoe UI', system-ui, sans-serif`;

export function apply(s: State) {
  const root = document.documentElement;
  for (const g of GROUPS) {
    const v = s[g.key] ?? g.default;
    if (g.kind === 'range') {
      if (v === '') { root.removeAttribute(`data-d-${g.key}`); root.style.removeProperty(`--lab-${g.key}`); }
      else { root.setAttribute(`data-d-${g.key}`, 'on'); root.style.setProperty(`--lab-${g.key}`, v); }
    } else root.setAttribute(`data-d-${g.key}`, v);
  }
  const body = FONTS.find((f) => f.value === s.bfont);
  const head = FONTS.find((f) => f.value === s.hfont);
  ensureFont(body); ensureFont(head);
  if (body && body.value !== 'plex') root.style.setProperty('--font', stackFor(body)); else root.style.removeProperty('--font');
  if (head && head.value !== 'plex') { root.style.setProperty('--font-head', stackFor(head)); root.setAttribute('data-d-hfont-on', '1'); }
  else { root.style.removeProperty('--font-head'); root.removeAttribute('data-d-hfont-on'); }
}

const label = (g: Group, v: string) => (g.kind === 'range' ? (v === '' ? 'off (theme value)' : `${v}${g.unit ?? ''}`) : g.options.find((o) => o.value === v)?.label ?? v);
/** A plain-text summary Ben can paste back to Claude. Lists what differs from the baked-in defaults first. */
export function summary(s: State): string {
  const changed = GROUPS.filter((g) => isChanged(g, s)).map((g) => `${g.section} / ${g.label}: ${label(g, s[g.key] ?? g.default)}`);
  const all = GROUPS.map((g) => `${g.section} / ${g.label}: ${label(g, s[g.key] ?? g.default)}`);
  return `Design Lab choices\nChanged from the baked-in look (${changed.length}):\n${changed.join('\n') || '(none)'}\n\nAll options:\n${all.join('\n')}\n\nJSON: ${JSON.stringify(s)}`;
}

/* ---------- contrast (WCAG) ---------- */
let canvas: CanvasRenderingContext2D | null = null;
function rgbOf(cssColor: string): [number, number, number] | null {
  canvas ??= document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  if (!canvas) return null;
  canvas.clearRect(0, 0, 1, 1);
  canvas.fillStyle = '#000'; canvas.fillStyle = cssColor; canvas.fillRect(0, 0, 1, 1);
  const d = canvas.getImageData(0, 0, 1, 1).data;
  return [d[0]!, d[1]!, d[2]!];
}
function resolve(expr: string): string {
  const el = document.createElement('span'); el.style.color = expr; document.body.appendChild(el);
  const col = getComputedStyle(el).color; el.remove(); return col;
}
const lum = ([r, g, b]: [number, number, number]) => { const f = (v: number) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
export type Contrast = { label: string; ratio: number | null };
const PAIRS: [string, string, string][] = [
  ['Body text on page', '--foreground', '--background'],
  ['Muted text on page', '--muted-foreground', '--background'],
  ['Text on primary button', '--primary-foreground', '--primary'],
  ['Primary colour on page (links)', '--primary', '--background'],
  ['Sidebar text on sidebar', '--sidebar-foreground', '--sidebar'],
];
export function contrastReport(): Contrast[] {
  return PAIRS.map(([name, fg, bg]) => {
    const a = rgbOf(resolve(`var(${fg})`)); const b = rgbOf(resolve(`var(${bg})`));
    if (!a || !b) return { label: name, ratio: null };
    const [hi, lo] = [Math.max(lum(a), lum(b)), Math.min(lum(a), lum(b))];
    return { label: name, ratio: (hi + 0.05) / (lo + 0.05) };
  });
}
