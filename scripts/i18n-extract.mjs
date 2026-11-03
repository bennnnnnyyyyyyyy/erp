// scripts/i18n-extract.mjs
// Lists the user-visible English text in the web app that has no Arabic yet, by reading the real code (an AST, via the oxc parser that ships
// inside rolldown), so translation work is based on a measured list instead of a guess. Read-only: it writes nothing unless you pass --json.
//
// What counts as user-visible text: JSX text, string props that are shown (placeholder, title, aria-label, alt, label, empty, hint,
// description), `label:`/`title:`/`empty:` properties in column and option objects, and string literals inside JSX expressions (for example the
// two sides of a ternary). Text built from template literals with variables is listed as "dynamic": it needs a whole-sentence translation,
// not a fragment. It cannot see text that comes from the API.
//
// Usage:  node scripts/i18n-extract.mjs                       summary per file and the totals
//         node scripts/i18n-extract.mjs --list                every string, with file and line
//         node scripts/i18n-extract.mjs --json out.json       machine-readable (for the translation sheet)
//         node scripts/i18n-extract.mjs --files a.tsx,b/c.tsx only these files (paths relative to apps/web/src)

import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseAst } from 'rolldown/parseAst';

const root = fileURLToPath(new URL('../apps/web/src/', import.meta.url));
const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const valueOf = (n) => (args.includes(n) ? args[args.indexOf(n) + 1] : undefined);

const SHOWN_ATTRS = new Set(['placeholder', 'title', 'aria-label', 'alt', 'label', 'empty', 'hint', 'description', 'summary', 'subtitle', 'period', 'intro', 'priceLabel', 'backLabel', 'submitLabel']);
const SHOWN_KEYS = new Set(['label', 'title', 'empty', 'placeholder', 'hint', 'description', 'summary', 'message', 'text', 'note', 'word', 'unit', 'intro', 'subtitle', 'period']);
const TRANSLATORS = new Set(['t', 'tr']);

function walkDir(dir) {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walkDir(p) : p.endsWith('.tsx') ? [p] : [];
  });
}

// Text that already contains Arabic letters is bilingual on purpose and is not counted.
const hasArabic = (s) => /[\u0600-\u06FF]/.test(s);

// Text with at least two letters in a row that is not a code-like token (an identifier, a path, a class name).
function looksLikeText(s) {
  const t = s.trim();
  if (hasArabic(t)) return false;
  if (!/[A-Za-z]{2}/.test(t)) return false;
  if (/^[\w./:#@$-]+$/.test(t) && !/\s/.test(t)) return /^[A-Z][a-z]{2,}$/.test(t); // a single word counts only when Capitalised ("Search")
  return true;
}

function extract(file) {
  const src = readFileSync(file, 'utf8');
  const ast = parseAst(src, { lang: 'tsx' }, file);
  const lineStarts = [0];
  for (let i = 0; i < src.length; i++) if (src[i] === '\n') lineStarts.push(i + 1);
  const lineOf = (pos) => {
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineStarts[mid] <= pos) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };
  const rel = relative(root, file).replaceAll('\\', '/');
  const out = [];
  const add = (node, text, kind) => {
    const t = String(text).replace(/\s+/g, ' ').trim();
    if (!t || !looksLikeText(t)) return;
    out.push({ file: rel, line: lineOf(node.start), text: t, kind });
  };
  // Inside t(...) / tr(...) means already translated.
  const inTranslator = (stack) => {
    const p = stack[stack.length - 1];
    return p && p.type === 'CallExpression' && p.callee?.type === 'Identifier' && TRANSLATORS.has(p.callee.name);
  };
  // A string literal sitting directly in a JSX expression, or on either side of a ternary / && / || inside one.
  // Not when that expression is the value of an attribute that is not shown to people (className, key, type, to, value...).
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
  const visit = (node, stack) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach((n) => visit(n, stack));
    if (typeof node.type !== 'string') return;
    switch (node.type) {
      case 'JSXText': {
        // Part of a sentence if a sibling is an expression ({count}) or an inline element (<b>): its word order cannot be translated alone.
        const siblings = stack[stack.length - 1]?.children ?? [];
        const mixed = siblings.some((s) => s !== node && (s.type === 'JSXExpressionContainer' && s.expression?.type !== 'JSXEmptyExpression' || s.type === 'JSXElement') && siblings.some((x) => x.type === 'JSXText' && x.value.trim() && x !== s) );
        add(node, node.value, mixed ? 'jsx-text-mixed' : 'jsx-text');
        break;
      }
      case 'JSXAttribute': {
        const name = node.name?.type === 'JSXIdentifier' ? node.name.name : '';
        if (SHOWN_ATTRS.has(name) && node.value?.type === 'Literal' && typeof node.value.value === 'string') add(node.value, node.value.value, `attr:${name}`);
        break;
      }
      case 'Property': {
        const key = node.key?.type === 'Identifier' ? node.key.name : node.key?.type === 'Literal' ? String(node.key.value) : '';
        if (SHOWN_KEYS.has(key) && node.value?.type === 'Literal' && typeof node.value.value === 'string') add(node.value, node.value.value, `prop:${key}`);
        break;
      }
      case 'Literal':
        if (typeof node.value === 'string' && !inTranslator(stack) && inJsxExpression(stack)) add(node, node.value, 'jsx-expr');
        break;
      case 'TemplateLiteral':
        if (node.expressions?.length && inJsxExpression(stack) && !inTranslator(stack)) {
          const text = node.quasis.map((q) => q.value.cooked ?? q.value.raw).join(' … ');
          if (/[A-Za-z]{3}/.test(text)) add(node, src.slice(node.start, node.end), 'dynamic');
        }
        break;
      default:
    }
    stack.push(node);
    for (const k of Object.keys(node)) if (k !== 'parent') visit(node[k], stack);
    stack.pop();
  };
  visit(ast, []);
  return out;
}

// The Arabic dictionaries: every string key of an object literal in these files counts as translated.
function dictionaryKeys() {
  const known = new Set();
  for (const f of ['lib/i18n.tsx', 'lib/i18nNav.ts', 'lib/i18nScreens.ts']) {
    let src;
    try {
      src = readFileSync(join(root, f), 'utf8');
    } catch {
      continue;
    }
    const ast = parseAst(src, { lang: f.endsWith('.tsx') ? 'tsx' : 'ts' }, f);
    (function walk(n) {
      if (!n || typeof n !== 'object') return;
      if (Array.isArray(n)) return n.forEach(walk);
      if (n.type === 'Property' && n.key) known.add(n.key.type === 'Identifier' ? n.key.name : String(n.key.value));
      for (const k of Object.keys(n)) if (k !== 'parent') walk(n[k]);
    })(ast);
  }
  return known;
}

const only = valueOf('--files')?.split(',').map((f) => join(root, f.trim()));
const BILINGUAL = /(components\/LanguageChooser|modules\/help\/TourHost|DemoApp|modules\/registry)\.tsx$/;
const files = (only ?? walkDir(root)).filter((f) => !f.endsWith('.test.tsx') && !BILINGUAL.test(f.replaceAll('\\\\', '/')));
const all = files.flatMap(extract);
const known = dictionaryKeys();
const missing = all.filter((s) => s.kind === 'dynamic' || !known.has(s.text));


// ---- Keys the code asks tr()/trf() to translate: the completeness check ------------------------------------------------------------------
// Direct calls with a string literal (also either side of a ternary argument), plus the text dictionaries that are translated where they are
// shown (a lookup like tr(STATUS_LABEL[x]) has no literal at the call site), plus a few computed words.
const DICTIONARIES = new Set(['STATUS_LABEL', 'ADJUSTMENT_STATUS', 'TITLE', 'REASONS', 'STATUS', 'STEPS', 'FLAG', 'KIND', 'ROLE_LABEL', 'ROLE_HELP', 'METHODS', 'TONE']);
const EXTRA_KEYS = ['available', 'quarantined', 'supplier', 'customer', 'item']; // words passed through variables

function collectKeys(files) {
  const keys = [];
  for (const file of files) {
    const src = readFileSync(file, 'utf8');
    const ast = parseAst(src, { lang: 'tsx' }, file);
    const rel = relative(root, file).replaceAll('\\', '/');
    const lineOf = (pos) => src.slice(0, pos).split('\n').length;
    const literalsIn = (n, out = []) => {
      if (!n) return out;
      if (n.type === 'Literal' && typeof n.value === 'string') out.push(n);
      else if (n.type === 'ConditionalExpression') { literalsIn(n.consequent, out); literalsIn(n.alternate, out); }
      else if (n.type === 'LogicalExpression') { literalsIn(n.left, out); literalsIn(n.right, out); }
      else if (n.type === 'ParenthesizedExpression') literalsIn(n.expression, out);
      return out;
    };
    const stringsDeep = (n, out = []) => {
      if (!n || typeof n !== 'object') return out;
      if (Array.isArray(n)) { n.forEach((x) => stringsDeep(x, out)); return out; }
      if (n.type === 'Literal' && typeof n.value === 'string') out.push(n);
      for (const k of Object.keys(n)) if (k !== 'parent') stringsDeep(n[k], out);
      return out;
    };
    (function walk(n, stack) {
      if (!n || typeof n !== 'object') return;
      if (Array.isArray(n)) return n.forEach((x) => walk(x, stack));
      if (typeof n.type !== 'string') return;
      if (n.type === 'CallExpression' && n.callee?.type === 'Identifier' && (n.callee.name === 'tr' || n.callee.name === 'trf') && n.arguments?.[0]) {
        for (const l of literalsIn(n.arguments[0])) if (l.value.trim() !== '') keys.push({ file: rel, line: lineOf(l.start), text: l.value, kind: n.callee.name });
      }
      if (n.type === 'VariableDeclarator' && n.id?.type === 'Identifier' && DICTIONARIES.has(n.id.name) && n.init) {
        const only = n.id.name === 'KIND' ? new Set(['label', 'hint', 'unit']) : n.id.name === 'TONE' ? new Set(['word']) : null;
        const fromProps = (o) => {
          if (o?.type === 'ObjectExpression') for (const pr of o.properties) {
            const k = pr.key?.type === 'Identifier' ? pr.key.name : '';
            if (pr.value?.type === 'Literal' && typeof pr.value.value === 'string') {
              if (n.id.name === 'FLAG' && k === 'pill') continue; // css status, not text
              if (n.id.name === 'STEPS' && k === 'key') continue;
              if (!only || only.has(k)) keys.push({ file: rel, line: lineOf(pr.value.start), text: pr.value.value, kind: `dict:${n.id.name}` });
            } else if (pr.value?.type === 'ObjectExpression') fromProps(pr.value);
          }
        };
        if (n.init.type === 'ArrayExpression' && n.id.name === 'METHODS') for (const l of stringsDeep(n.init)) keys.push({ file: rel, line: lineOf(l.start), text: l.value, kind: 'dict:METHODS' });
        else if (n.init.type === 'ArrayExpression') for (const el of n.init.elements) fromProps(el);
        else fromProps(n.init);
      }
      if (n.type === 'JSXAttribute' && n.name?.name === 'noun' && n.value?.type === 'Literal') keys.push({ file: rel, line: lineOf(n.value.start), text: String(n.value.value), kind: 'noun' });
      stack.push(n);
      for (const k of Object.keys(n)) if (k !== 'parent') walk(n[k], stack);
      stack.pop();
    })(ast, []);
  }
  for (const text of EXTRA_KEYS) keys.push({ file: '(computed)', line: 0, text, kind: 'extra' });
  return keys;
}

if (flag('--keys') || flag('--missing')) {
  const keys = collectKeys(files);
  const uniq = new Map();
  for (const k of keys) if (!uniq.has(k.text)) uniq.set(k.text, k);
  const need = [...uniq.values()].filter((k) => flag('--keys') || !known.has(k.text));
  if (valueOf('--json')) writeFileSync(valueOf('--json'), JSON.stringify(need, null, 2));
  if (flag('--list')) for (const k of need) console.log(`${k.file}:${k.line}  [${k.kind}]  ${JSON.stringify(k.text)}`);
  console.log(`\n${uniq.size} distinct keys the code translates; ${[...uniq.values()].filter((k) => !known.has(k.text)).length} have no Arabic yet.`);
  if (flag('--missing') && [...uniq.values()].some((k) => !known.has(k.text))) process.exitCode = 1;
  process.exit(process.exitCode ?? 0);
}
if (valueOf('--json')) writeFileSync(valueOf('--json'), JSON.stringify(missing, null, 2));
if (flag('--list')) for (const s of missing) console.log(`${s.file}:${s.line}  [${s.kind}]  ${s.text}`);

const byFile = new Map();
for (const s of missing) byFile.set(s.file, (byFile.get(s.file) ?? 0) + 1);
console.log(`\n${missing.length} strings without Arabic in ${byFile.size} of ${files.length} files (${all.length} found, ${all.length - missing.length} already translated).`);
console.log(`unique texts: ${new Set(missing.filter((s) => s.kind !== 'dynamic').map((s) => s.text)).size}; dynamic (need whole-sentence translation): ${missing.filter((s) => s.kind === 'dynamic').length}`);
for (const [f, n] of [...byFile.entries()].sort((a, b) => b[1] - a[1])) console.log(`${String(n).padStart(5)}  ${f}`);
