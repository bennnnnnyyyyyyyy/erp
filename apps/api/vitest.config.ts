import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Tests use this checkout's own shared package. In the main checkout it is the same folder as node_modules/@erp/shared; in a git
// worktree (which has no node_modules of its own) the package name would resolve to the main checkout's copy instead.
export default defineConfig({
  resolve: { alias: { '@erp/shared': fileURLToPath(new URL('../../packages/shared/src/index.ts', import.meta.url)) } },
});
