// On-premises entry point (documentation/planning/2026-11-19-on-prem-deployment-plan.md, step 1). The same Hono app as the Cloudflare
// Worker (src/index.ts), served by Node's own HTTP server, with no extra package:
//   * settings come from environment variables (the .env file the installer writes) instead of wrangler.toml and Worker secrets;
//   * the two Worker rate limiters are replaced by an in-memory one with the same limits (600 and 3000 a minute);
//   * the Worker's 5-minute cron (message delivery, reminders, exchange rates) runs on a timer.
// Run: bundled with esbuild into one file (scripts/onprem/Dockerfile.api), then `node node.mjs`.

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { Bindings } from './env';
import app from './index';

/** A fixed-window limiter with the Workers rate limiting binding's shape: limit({ key }) -> { success }. */
export function memoryLimiter(limit: number, periodMs: number) {
  const windows = new Map<string, { start: number; count: number }>();
  return {
    async limit({ key }: { key: string }) {
      const now = Date.now();
      const w = windows.get(key);
      if (!w || now - w.start >= periodMs) {
        windows.set(key, { start: now, count: 1 });
        if (windows.size > 50_000) for (const [k, v] of windows) if (now - v.start >= periodMs) windows.delete(k);
        return { success: true };
      }
      w.count += 1;
      return { success: w.count <= limit };
    },
  };
}

/** The Worker bindings, read from the environment. Every value the Worker reads as a var or secret has the same name here. */
export function bindingsFromEnv(env: NodeJS.ProcessEnv): Bindings {
  const pick = (k: string) => (env[k] === undefined || env[k] === '' ? undefined : env[k]);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(env)) if (/^[A-Z][A-Z0-9_]*$/.test(k) && v !== undefined && v !== '') out[k] = v;
  return {
    ...(out as Partial<Bindings>),
    APP_ENV: pick('APP_ENV') ?? 'onprem',
    ALLOWED_ORIGINS: pick('ALLOWED_ORIGINS') ?? '',
    API_LIMITER: memoryLimiter(600, 60_000),
    IP_LIMITER: memoryLimiter(3000, 60_000),
  } as Bindings;
}

/** Node request -> web Request (the client's address goes in the header the Worker reads it from). */
async function toRequest(req: IncomingMessage, origin: string): Promise<Request> {
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (Array.isArray(v)) for (const x of v) headers.append(k, x);
    else if (v !== undefined) headers.set(k, v);
  }
  // Never trust a client-sent cf-connecting-ip: the API is only reachable through the package's own web server (Caddy), which sets
  // X-Forwarded-For; the per-IP limiter reads the address from here.
  const forwarded = headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  headers.set('cf-connecting-ip', forwarded || req.socket.remoteAddress || 'unknown');
  const method = req.method ?? 'GET';
  let body: Buffer | undefined;
  if (method !== 'GET' && method !== 'HEAD') {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    body = Buffer.concat(chunks);
  }
  return new Request(new URL(req.url ?? '/', origin), { method, headers, body });
}

async function send(res: ServerResponse, response: Response) {
  const headers: Record<string, string | string[]> = {};
  response.headers.forEach((value, key) => {
    if (key === 'set-cookie') headers[key] = [...((headers[key] as string[] | undefined) ?? []), value];
    else headers[key] = value;
  });
  res.writeHead(response.status, headers);
  if (response.body) for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) res.write(chunk);
  res.end();
}

/** Promises a request or job hands to waitUntil keep running after the answer; errors are logged, never thrown. */
function executionContext(): ExecutionContext {
  return {
    waitUntil: (p: Promise<unknown>) => void p.catch((e) => console.error('background task failed', e)),
    passThroughOnException: () => undefined,
    props: {},
  } as unknown as ExecutionContext;
}

export function start(env: NodeJS.ProcessEnv = process.env) {
  const bindings = bindingsFromEnv(env);
  const port = Number(env.PORT ?? 8787);
  const origin = `http://localhost:${port}`;
  const server = createServer(async (req, res) => {
    try {
      await send(res, await app.fetch(await toRequest(req, origin), bindings, executionContext()));
    } catch (err) {
      console.error(err);
      if (!res.headersSent) res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Something went wrong on our side' } }));
    }
  });
  server.listen(port, () => console.log(`ERP API (on-prem) listening on ${port}`));
  // The Worker's cron: every 5 minutes. CRON_DISABLED=1 turns it off (for a second API container).
  const cron =
    env.CRON_DISABLED === '1'
      ? null
      : setInterval(() => void app.scheduled({} as ScheduledController, bindings, executionContext()), 5 * 60_000);
  return { server, stop: () => (cron && clearInterval(cron), server.close()) };
}

// Started directly (node src/node.ts), not when imported by a test.
if (process.argv[1] && /node\.(ts|js|mjs)$/.test(process.argv[1])) start();
