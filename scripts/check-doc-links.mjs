// Checks that relative links between the repository's own Markdown files resolve (repo audit 2026-11-06, finding 6).
// Reads: every *.md file git tracks or would track (not ignored), except templates and documentation/reference/ (third-party pages),
// and scripts/check-doc-links.known.txt (links known to be broken, one "file -> target" per line, each with a reason). Writes: nothing.
// Usage: node scripts/check-doc-links.mjs   (exit code 1 and a list when a link is broken)
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const known = new Set(
  fs
    .readFileSync(new URL('./check-doc-links.known.txt', import.meta.url), 'utf8')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#')),
);

const files = execSync('git -c core.quotepath=off ls-files --cached --others --exclude-standard "*.md"', { encoding: 'utf8' })
  .split('\n')
  .filter((f) => f && !f.includes('_TEMPLATE') && !f.endsWith('MODULE_PLAN_TEMPLATE.md') && !f.startsWith('documentation/reference/'));

const linkRe = /\]\(([^)\s]+)\)/g;
const broken = [];
for (const file of files) {
  // Fenced code blocks hold examples, not links.
  const text = fs.readFileSync(file, 'utf8').replace(/```[\s\S]*?```/g, '');
  for (const m of text.matchAll(linkRe)) {
    const target = m[1];
    // Web links, anchors, placeholders, and absolute paths on one person's machine (/C:/Users/...), which no other checkout has.
    if (/^(https?:|mailto:|#|file:)/.test(target) || target.startsWith('<') || /^\/?[A-Za-z]:\//.test(target)) continue;
    let rel;
    try {
      rel = decodeURIComponent(target.split('#')[0].replace(/:\d+(:\d+)?$/, ''));
    } catch {
      rel = target;
    }
    if (!rel) continue;
    const resolved = rel.startsWith('/') ? path.resolve(rel.slice(1)) : path.resolve(path.dirname(file), rel);
    const entry = `${file} -> ${target}`;
    if (!fs.existsSync(resolved) && !known.has(entry)) broken.push(entry);
  }
}

if (broken.length) {
  console.error(`Broken documentation links (${broken.length}):\n${broken.join('\n')}`);
  process.exit(1);
}
console.log(`Documentation links OK (${files.length} files).`);
