// scripts/check-migrations.mjs
// CI guard (18 Nov 2026): several chats write migrations in parallel. Fails when two migrations (or two SQL tests) share a number, or a
// migration has no row in sql/README.md (where each one's purpose and live status are recorded). Read-only.
// Usage: node scripts/check-migrations.mjs
import { readdirSync, readFileSync } from 'node:fs';

const problems = [];
const numbered = (dir) => readdirSync(dir).filter((f) => /^\d{3}_.+\.sql$/.test(f));

for (const [dir, label] of [['sql', 'migration'], ['sql/tests', 'SQL test']]) {
  const seen = new Map();
  for (const f of numbered(dir)) {
    const n = f.slice(0, 3);
    if (seen.has(n)) problems.push(`two ${label}s share number ${n}: ${seen.get(n)} and ${f}`);
    else seen.set(n, f);
  }
}

const readme = readFileSync('sql/README.md', 'utf8');
for (const f of numbered('sql')) {
  if (!readme.includes(`\`${f}\``)) problems.push(`sql/${f} has no row in sql/README.md`);
}

if (problems.length) {
  console.error(`Migration check failed:\n- ${problems.join('\n- ')}`);
  process.exit(1);
}
console.log(`Migrations OK (${numbered('sql').length} migrations, ${numbered('sql/tests').length} SQL tests, numbers unique, all in sql/README.md).`);
