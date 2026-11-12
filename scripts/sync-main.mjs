// Brings the latest origin/main into the branch this folder is on, so a long-lived branch (for example the UI branch) does not drift.
//   node scripts/sync-main.mjs            merge origin/main when it is safe
//   node scripts/sync-main.mjs --dry-run  only say what it would do
//   node scripts/sync-main.mjs --push     also push the branch after a successful merge (off by default: Ben pushes)
// Safety: never runs on main; skips (and says why) when there are uncommitted changes to tracked files or a merge/rebase is already
// in progress; on a conflict it aborts the merge so the branch is left exactly as it was and lists the conflicting files.
// No dependencies. Every run appends a line to the git directory's sync-main.log (not tracked). Exit code 0 = fine (including
// "nothing to do" and "skipped"), 2 = conflict (branch untouched), 1 = error.
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync } from 'node:fs';

const args = new Set(process.argv.slice(2));
const dry = args.has('--dry-run');
const push = args.has('--push');
// A scheduled task may not have git on its PATH: fall back to the portable copy named in agents.md.
const GIT = spawnSync('git', ['--version']).status === 0 ? 'git' : 'C:\\Users\\ben.arthur\\PortableGit\\bin\\git.exe';

const git = (...a) => spawnSync(GIT, a, { encoding: 'utf8' });
const out = (r) => (r.stdout ?? '').trim();
let logFile = null;
function log(msg) {
  const line = `${new Date().toISOString()}  ${msg}`;
  console.log(line);
  if (logFile) { try { appendFileSync(logFile, line + '\n'); } catch { /* the log is a convenience */ } }
}

const top = git('rev-parse', '--show-toplevel');
if (top.status !== 0) { console.error('Not inside a git repository.'); process.exit(1); }
logFile = out(git('rev-parse', '--git-path', 'sync-main.log'));
process.chdir(out(top));

const branch = out(git('rev-parse', '--abbrev-ref', 'HEAD'));
if (branch === 'main' || branch === 'HEAD') { log(`skipped: on "${branch}" (this script only updates other branches)`); process.exit(0); }

const gitDir = out(git('rev-parse', '--absolute-git-dir'));
if (['MERGE_HEAD', 'rebase-merge', 'rebase-apply', 'CHERRY_PICK_HEAD'].some((f) => existsSync(`${gitDir}/${f}`))) {
  log(`skipped: a merge, rebase or cherry-pick is already in progress on ${branch}`); process.exit(0);
}

const fetched = git('fetch', 'origin', 'main', '--quiet');
if (fetched.status !== 0) { log(`error: could not fetch origin/main (${out({ stdout: fetched.stderr })})`); process.exit(1); }

const [ahead, behind] = out(git('rev-list', '--left-right', '--count', `HEAD...origin/main`)).split(/\s+/).map(Number);
if (!behind) { log(`${branch}: already up to date with main (${ahead} commit(s) ahead)`); process.exit(0); }

const dirty = out(git('status', '--porcelain', '--untracked-files=no'));
if (dirty) {
  log(`skipped: ${branch} has uncommitted changes to tracked files; main has ${behind} new commit(s). Commit or stash them, then run again.`);
  process.exit(0);
}
if (dry) { log(`dry run: would merge ${behind} new commit(s) from origin/main into ${branch}`); process.exit(0); }

const merged = git('merge', '--no-edit', '-m', `Merge origin/main into ${branch} (auto-sync, ${behind} new commit(s))`, 'origin/main');
if (merged.status !== 0) {
  const files = out(git('diff', '--name-only', '--diff-filter=U')).split('\n').filter(Boolean);
  git('merge', '--abort');
  log(`CONFLICT: merging main into ${branch} touches ${files.length} file(s) that both sides changed: ${files.join(', ') || '(see git merge)'}. Merge aborted, ${branch} is unchanged. Resolve by hand (git merge origin/main).`);
  process.exit(2);
}
log(`merged ${behind} new commit(s) from origin/main into ${branch} (now ${out(git('rev-parse', '--short', 'HEAD'))})`);

if (push) {
  const pushed = git('push', 'origin', branch);
  log(pushed.status === 0 ? `pushed ${branch}` : `push failed (the merge is kept locally): ${out({ stdout: pushed.stderr })}`);
}
process.exit(0);
