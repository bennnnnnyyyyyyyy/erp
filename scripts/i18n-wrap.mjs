// scripts/i18n-wrap.mjs
// Wraps visible English text in the web app with the translator, tr('...'), so it can show in Arabic. Re-runnable and idempotent: text that is
// already wrapped is skipped, so after someone else changes a screen you run it again instead of merging by hand.
//
// It wraps (same rules as scripts/i18n-extract.mjs): JSX text, shown string props (placeholder, title, aria-label, alt, label, empty, hint,
// description), `label:`/`title:`/`empty:`/`hint:` properties, and string literals inside JSX expressions (ternary sides). It only touches code
// that runs at render time (inside a function): text in module-level constants would be read before the language is known, so it is listed
// as "skipped" for a human to move. It never touches template literals with variables (a person rewrites those as whole sentences, see trf()).
//
// Usage:  node scripts/i18n-wrap.mjs --check         report what it would change, change nothing (exit 1 if there is anything to wrap)
//         node scripts/i18n-wrap.mjs --write         apply
//         node scripts/i18n-wrap.mjs --write --files modules/inventory/Inventory.tsx,components/SignIn.tsx

import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseAst } from 'rolldown/parseAst';

const root = fileURLToPath(new URL('../apps/web/src/', import.meta.url));
const args = process.argv.slice(2);
const write = args.includes('--write');
const only = args.includes('--files') ? args[args.indexOf('--files') + 1].split(',').map((f) => join(root, f.trim())) : null;

const SHOWN_ATTRS = new Set(['placeholder', 'title', 'aria-label', 'alt', 'label', 'empty', 'hint', 'description', 'summary', 'subtitle', 'period', 'intro', 'priceLabel', 'backLabel', 'submitLabel']);
const SHOWN_KEYS = new Set(['label', 'title', 'empty', 'placeholder', 'hint', 'description', 'summary', 'message', 'text', 'note', 'word', 'unit', 'intro', 'subtitle', 'period']);
const FUNCTIONS = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression']);
// Not these: the bilingual language chooser and tour dialog (English and Arabic side by side on purpose), the demo banner and the app registry.
const SKIP_FILES = /(^|\/)(lib\/i18n[A-Za-z]*\.tsx?|.*\.test\.tsx?|components\/LanguageChooser\.tsx|modules\/help\/TourHost\.tsx|DemoApp\.tsx|modules\/registry\.tsx)$/;
// Text that already contains Arabic letters is bilingual on purpose and is never wrapped.
const hasArabic = (s) => /[\u0600-\u06FF]/.test(s);

function walkDir(dir) {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walkDir(p) : p.endsWith('.tsx') ? [p] : [];
  });
}

function looksLikeText(s) {
  const t = s.trim();
  if (hasArabic(t) || t === 'English') return false;   // language names are shown in their own language
  if (!/[A-Za-z]{2}/.test(t)) return false;
  if (/^[\w./:#@$-]+$/.test(t) && !/\s/.test(t)) return /^[A-Z][a-z]{2,}$/.test(t);
  return true;
}
const quote = (s) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

function plan(file) {
  const src = readFileSync(file, 'utf8');
  const ast = parseAst(src, { lang: 'tsx' }, file);
  const edits = [];
  const skipped = [];
  const lineOf = (pos) => src.slice(0, pos).split('\n').length;
  const rel = relative(root, file).replaceAll('\\', '/');
  const inTranslator = (stack) => {
    const p = stack[stack.length - 1];
    return p && p.type === 'CallExpression' && p.callee?.type === 'Identifier' && (p.callee.name === 't' || p.callee.name === 'tr');
  };
  const inJsxExpression = (stack) => {
    for (let i = stack.length - 1; i >= 0; i--) {
      const n = stack[i];
      if (n.type === 'ConditionalExpression' || n.type === 'LogicalExpression' || n.type === 'ParenthesizedExpression') continue;
      if (n.type !== 'JSXExpressionContainer') return false;
      const owner = stack[i - 1];
      if (owner?.type === 'JSXAttribute') return owner.name?.type === 'JSXIdentifier' && SHOWN_ATTRS.has(owner.name.name);
      return true;
    }
    return false;
  };
  // A string literal in a ternary's TEST or an equality comparison is logic, not text: only the result branches count.
  const isResultPosition = (stack, node) => {
    for (let i = stack.length - 1; i >= 0; i--) {
      const p = stack[i];
      if (p.type === 'ConditionalExpression') return p.test !== node && !contains(p.test, node);
      if (p.type !== 'LogicalExpression' && p.type !== 'ParenthesizedExpression') return true;
      node = p;
    }
    return true;
  };
  const contains = (outer, inner) => outer.start <= inner.start && inner.end <= outer.end;

  const visit = (node, stack, fn) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach((n) => visit(n, stack, fn));
    if (typeof node.type !== 'string') return;
    const insideFn = fn || FUNCTIONS.has(node.type);
    const queue = (n, replacement, text) => {
      if (!insideFn) skipped.push({ file: rel, line: lineOf(n.start), text, why: 'module-level (move into the component)' });
      else edits.push({ start: n.start, end: n.end, replacement });
    };
    switch (node.type) {
      case 'JSXText': {
        const raw = src.slice(node.start, node.end);
        const lead = raw.length - raw.trimStart().length;
        const core = raw.trim();
        const key = String(node.value).replace(/\s+/g, ' ').trim();
        if (key && looksLikeText(key)) {
          if (!insideFn) skipped.push({ file: rel, line: lineOf(node.start), text: key, why: 'module-level (move into the component)' });
          else edits.push({ start: node.start + lead, end: node.start + lead + core.length, replacement: `{tr(${quote(key)})}` });
        }
        break;
      }
      case 'JSXAttribute': {
        const name = node.name?.type === 'JSXIdentifier' ? node.name.name : '';
        const v = node.value;
        if (SHOWN_ATTRS.has(name) && v?.type === 'Literal' && typeof v.value === 'string' && looksLikeText(v.value)) queue(v, `{tr(${quote(v.value)})}`, v.value);
        break;
      }
      case 'Property': {
        const key = node.key?.type === 'Identifier' ? node.key.name : node.key?.type === 'Literal' ? String(node.key.value) : '';
        const v = node.value;
        if (SHOWN_KEYS.has(key) && v?.type === 'Literal' && typeof v.value === 'string' && looksLikeText(v.value) && !inTranslator(stack)) queue(v, `tr(${quote(v.value)})`, v.value);
        break;
      }
      case 'Literal':
        if (typeof node.value === 'string' && /[A-Za-z]{2}/.test(node.value) && node.value !== 'English' && !inTranslator(stack) && inJsxExpression(stack) && isResultPosition(stack, node)) queue(node, `tr(${quote(node.value)})`, node.value);
        break;
      default:
    }
    stack.push(node);
    for (const k of Object.keys(node)) if (k !== 'parent') visit(node[k], stack, insideFn);
    stack.pop();
  };
  visit(ast, [], false);
  return { src, edits, skipped, rel };
}

function withImport(src, file) {
  if (/\btr\b[^;\n]*from\s+['"][^'"]*lib\/i18n['"]/.test(src)) return src;
  const target = posix.relative(dirname(relative(root, file).replaceAll('\\', '/')), 'lib/i18n').replace(/^(?!\.)/, './');
  const existing = src.match(/import\s*\{([^}]*)\}\s*from\s*(['"])([^'"]*lib\/i18n)\2;?/);
  if (existing) return src.replace(existing[0], existing[0].replace(`{${existing[1]}}`, `{${existing[1].trim() ? existing[1].trim() + ', ' : ''}tr }`.replace('  ', ' ')));
  const imports = [...src.matchAll(/^import[\s\S]*?;\s*$/gm)];
  const at = imports.length ? imports[imports.length - 1].index + imports[imports.length - 1][0].length : 0;
  return `${src.slice(0, at)}\nimport { tr } from '${target}';${src.slice(at)}`;
}

const files = (only ?? walkDir(root)).filter((f) => !SKIP_FILES.test(relative(root, f).replaceAll('\\', '/')));
let total = 0;
const allSkipped = [];
const perFile = [];
for (const f of files) {
  const { src, edits, skipped, rel } = plan(f);
  allSkipped.push(...skipped);
  if (edits.length === 0) continue;
  total += edits.length;
  perFile.push([rel, edits.length]);
  if (write) {
    let out = src;
    for (const e of [...edits].sort((a, b) => b.start - a.start)) out = out.slice(0, e.start) + e.replacement + out.slice(e.end);
    writeFileSync(f, withImport(out, f));
  }
}
for (const [f, n] of perFile.sort((a, b) => b[1] - a[1])) console.log(`${String(n).padStart(5)}  ${f}`);
console.log(`\n${total} text(s) ${write ? 'wrapped' : 'would be wrapped'} in ${perFile.length} files.`);
if (allSkipped.length) {
  console.log(`\n${allSkipped.length} skipped (a person must move these, they would be read before the language is known):`);
  for (const s of allSkipped) console.log(`  ${s.file}:${s.line}  ${s.text}`);
}
if (!write && total > 0) process.exit(1);
