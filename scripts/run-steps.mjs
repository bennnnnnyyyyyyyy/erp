// Runs shell commands one after another and stops at the first failure: a portable replacement for `a && b` in npm scripts,
// which fails in the project's Windows PowerShell setup (audit 11 Nov 2026, finding 10). Usage in package.json:
//   "build": "node ../../scripts/run-steps.mjs \"tsc -p tsconfig.json\" \"vite build\""
// Commands run in the package's own folder, with its node_modules/.bin on the PATH (npm already provides that).
import { spawnSync } from 'node:child_process';

const steps = process.argv.slice(2);
if (steps.length === 0) {
  console.error('run-steps: give at least one command');
  process.exit(2);
}
for (const step of steps) {
  const r = spawnSync(step, { stdio: 'inherit', shell: true });
  if (r.status !== 0) process.exit(r.status ?? 1);
}
