// Builds the web app for a Cloudflare PREVIEW of the real app (with the Design Lab) and checks the result before you deploy it:
//   npm run preview:build
//   npx wrangler pages deploy apps/web/dist --project-name erp-live --branch worktree-ui-warm     (never --branch main)
// It sets the two things that were missing when a preview showed "Failed to fetch": the API address (without it the app calls
// http://localhost:8787, i.e. your own computer) and DESIGN_LAB=1 (without it there is no Lab). It then reads the built files and stops
// with a clear message if either is wrong, so a bad build is never uploaded. See documentation/operations/PREVIEW_DEPLOYS.md.
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const API_URL = 'https://erp-api.meetings-dmedeskai.workers.dev';   // the same address ci-deploy.yml builds the live app with
const env = { ...process.env, DESIGN_LAB: '1', VITE_API_BASE_URL: API_URL };

console.log(`Building the web app with the API at ${API_URL} and the Design Lab included...`);
const build = spawnSync('npm', ['run', 'build', '-w', 'apps/web'], { env, stdio: 'inherit', shell: true });
if (build.status !== 0) { console.error('\nThe build failed, nothing to deploy.'); process.exit(1); }

const dir = join('apps', 'web', 'dist', 'assets');
if (!existsSync(dir)) { console.error(`\nNo built files in ${dir}.`); process.exit(1); }
const js = readdirSync(dir).filter((f) => f.endsWith('.js')).map((f) => readFileSync(join(dir, f), 'utf8'));
const has = (needle) => js.some((b) => b.includes(needle));
const problems = [];
if (!has(API_URL)) problems.push(`the API address ${API_URL} is not in the build`);
if (has('http://localhost:8787')) problems.push('the build still points at http://localhost:8787 (your own computer): this is what shows "Failed to fetch" on a preview');
if (!has('Copy my choices')) problems.push('the Design Lab is not in the build');
if (!has('.supabase.co')) problems.push('no Supabase address is in the build (is SUPABASE_URL set in the repository .env?)');
if (problems.length) {
  console.error('\nDo NOT deploy this build:');
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log('\nBuild checked: it calls the real API, has the Design Lab and a Supabase address.');
console.log('Deploy it as a PREVIEW (never --branch main):');
console.log('  npx wrangler pages deploy apps/web/dist --project-name erp-live --branch worktree-ui-warm');
console.log('Then open https://worktree-ui-warm.erp-live.pages.dev (the alias; the per-deployment address is refused by the API).');
