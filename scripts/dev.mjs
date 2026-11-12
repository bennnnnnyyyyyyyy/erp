// Starts the API (wrangler, :8787) and the web app (vite, :5173) together: `npm run dev`.
// Output of each is prefixed [api] / [web]. Ctrl+C stops both. No extra dependency.
import { spawn } from 'node:child_process';

const procs = [
  { name: 'api', args: ['run', 'dev', '-w', 'apps/api'] },
  { name: 'web', args: ['run', 'dev', '-w', 'apps/web'] },
];

const children = procs.map(({ name, args }) => {
  // shell: true so `npm` resolves to npm.cmd on Windows.
  const child = spawn('npm', args, { shell: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const pipe = (stream, out) => {
    let buf = '';
    stream.on('data', (d) => {
      buf += d.toString();
      const lines = buf.split(/\r?\n/);
      buf = lines.pop() ?? '';
      for (const l of lines) if (l.trim()) out.write(`[${name}] ${l}\n`);
    });
  };
  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);
  child.on('exit', (code) => {
    console.log(`[${name}] exited (${code}). Stopping the other one.`);
    stop();
  });
  return child;
});

let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  for (const c of children) {
    if (c.pid == null) continue;
    // Kill the whole process tree (npm -> node -> wrangler/vite); plain kill() leaves the grandchildren running on Windows.
    if (process.platform === 'win32') spawn('taskkill', ['/PID', String(c.pid), '/T', '/F'], { stdio: 'ignore' });
    else c.kill('SIGTERM');
  }
  setTimeout(() => process.exit(0), 1500);
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
