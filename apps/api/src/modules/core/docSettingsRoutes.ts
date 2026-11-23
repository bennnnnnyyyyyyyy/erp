import { Hono } from 'hono';
import {
  DEFAULT_DOC_SETTINGS,
  DOC_DIGITS,
  DOC_IMAGE_TYPES,
  DOC_LANGUAGES,
  DOC_LAYOUTS,
  DOC_LETTERHEAD_MAX_CHARS,
  DOC_LOGO_MAX_CHARS,
  DOC_SEND_MODES,
  type DocSettings,
} from '@erp/shared';
import type { AppEnv } from '../../env';
import { invalid, jsonBody } from '../../lib/body';
import { userDb } from '../../lib/db.user';
import { ok } from '../../lib/response';
import { callRpc } from '../../lib/rpc';
import { requirePermission } from '../../middleware/tenant';

// The company's own branding on its documents (sql/103, core_doc_settings): logo, letterhead, margins, texts, language, digits, layout and
// how "Send" works. Everyone in the company reads it (the print needs it); owners and admins change it (core.templates.manage; the
// database checks the role again). This is the customer's look on its own invoices; the app itself always looks like Bellvox.
export const docSettingsRoutes = new Hono<AppEnv>();

type Row = {
  logo: string | null;
  letterhead: string | null;
  margin_top_mm: number;
  margin_bottom_mm: number;
  header_text: string | null;
  footer_text: string | null;
  bank_details: string | null;
  payment_terms: string | null;
  language: DocSettings['language'];
  digits: DocSettings['digits'];
  layout: DocSettings['layout'];
  send_mode: NonNullable<DocSettings['sendMode']>;
};

const toSettings = (r: Row | null): DocSettings =>
  r
    ? {
        logo: r.logo,
        letterhead: r.letterhead,
        marginTopMm: r.margin_top_mm,
        marginBottomMm: r.margin_bottom_mm,
        headerText: r.header_text,
        footerText: r.footer_text,
        bankDetails: r.bank_details,
        paymentTerms: r.payment_terms,
        language: r.language,
        digits: r.digits,
        layout: r.layout,
        sendMode: r.send_mode,
      }
    : { ...DEFAULT_DOC_SETTINGS };

docSettingsRoutes.get('/', requirePermission('core.org.read'), async (c) => {
  const { data, error } = await userDb(c).from('core_doc_settings').select('*').eq('org_id', c.var.tenant.orgId).maybeSingle();
  if (error) throw error;
  return ok(c, toSettings(data as Row | null));
});

// The data: address of an image the database accepts (PNG, JPEG or WebP; never SVG, which can carry script).
const IMAGE_RE = new RegExp(`^data:(${DOC_IMAGE_TYPES.map((t) => t.replace('/', '\\/')).join('|')});base64,[A-Za-z0-9+/]+=*$`);
const TEXTS: [keyof DocSettings, number][] = [
  ['headerText', 1000],
  ['footerText', 1000],
  ['bankDetails', 1000],
  ['paymentTerms', 500],
];

// Only the fields given change. An image or text given as null or "" is cleared.
docSettingsRoutes.put('/', requirePermission('core.templates.manage'), async (c) => {
  const b = await jsonBody(c);
  const p: Record<string, unknown> = {};
  for (const [key, max] of [
    ['logo', DOC_LOGO_MAX_CHARS],
    ['letterhead', DOC_LETTERHEAD_MAX_CHARS],
  ] as const) {
    if (!(key in b)) continue;
    const v = b[key];
    if (v === null || v === '') p[key] = null;
    else if (typeof v !== 'string' || !IMAGE_RE.test(v)) invalid('Images must be PNG, JPEG or WebP');
    else if (v.length > max)
      invalid(key === 'logo' ? 'The logo is too large (about 300 KB at most)' : 'The letterhead is too large (about 1.5 MB at most)');
    else p[key] = v;
  }
  for (const key of ['marginTopMm', 'marginBottomMm'] as const) {
    if (!(key in b)) continue;
    const n = Number(b[key]);
    if (!Number.isInteger(n) || n < 0 || n > 150) invalid('Margins are whole millimetres from 0 to 150');
    p[key] = n;
  }
  for (const [key, max] of TEXTS) {
    if (!(key in b)) continue;
    const v = b[key];
    if (v !== null && typeof v !== 'string') invalid('Texts must be text');
    if (typeof v === 'string' && v.trim().length > max) invalid(`A text is too long (${max} characters at most)`);
    p[key] = typeof v === 'string' ? v.trim() : null;
  }
  const choices: [keyof DocSettings, readonly string[]][] = [
    ['language', DOC_LANGUAGES],
    ['digits', DOC_DIGITS],
    ['layout', DOC_LAYOUTS],
    ['sendMode', DOC_SEND_MODES],
  ];
  for (const [key, allowed] of choices) {
    if (!(key in b)) continue;
    if (typeof b[key] !== 'string' || !allowed.includes(b[key] as string)) invalid(`Unknown choice for ${key}`);
    p[key] = b[key];
  }
  if (Object.keys(p).length === 0) invalid('Nothing to change');
  const r = await callRpc<{ changed: string[] }>(userDb(c), 'core_save_doc_settings', { p });
  const { data, error } = await userDb(c).from('core_doc_settings').select('*').eq('org_id', c.var.tenant.orgId).maybeSingle();
  if (error) throw error;
  return ok(c, { ...toSettings(data as Row | null), changed: r.changed });
});
