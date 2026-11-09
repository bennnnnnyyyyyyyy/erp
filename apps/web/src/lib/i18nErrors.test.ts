import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ERRORS_AR } from './i18nErrors';

// Every reason the server can give (apps/api/src/lib/rpc.ts) has Arabic, so no Arabic user sees an English refusal (UX audit 9 Nov).
const rpc = readFileSync(join(__dirname, '../../../api/src/lib/rpc.ts'), 'utf8');
const messages = [...rpc.matchAll(/message:\s*(['"])(.+?)\1/g)].map((m) => m[2] as string);

describe('server error translations', () => {
  it('finds the server messages', () => {
    expect(messages.length).toBeGreaterThan(40);
  });

  it('has Arabic for every server message', () => {
    const missing = messages.filter((m) => !ERRORS_AR[m]);
    expect(missing).toEqual([]);
  });

  it('is actually Arabic', () => {
    for (const [en, ar] of Object.entries(ERRORS_AR)) expect(/[؀-ۿ]/.test(ar), en).toBe(true);
  });
});
