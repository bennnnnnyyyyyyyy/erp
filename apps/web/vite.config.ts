import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));

export default defineConfig(({ mode }) => {
  // One .env at the repo root serves both apps. Only the two public values are handed to the
  // browser; SUPABASE_SECRET_KEY never leaves the API.
  // A demo build is meant to be put on a public URL, so it never picks up real Supabase values.
  const env = mode === 'demo' ? {} : loadEnv(mode, repoRoot, '');
  return {
    envDir: repoRoot,
    plugins: [react()],
    server: { port: 5173 },
    define: {
      'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(env.SUPABASE_URL ?? ''),
      'import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY': JSON.stringify(env.SUPABASE_PUBLISHABLE_KEY ?? ''),
      // Show "Continue with Google" only once the provider is set up in Supabase Auth.
      'import.meta.env.VITE_AUTH_GOOGLE_ENABLED': JSON.stringify(env.AUTH_GOOGLE_ENABLED ?? ''),
      // Sample-data demo (npm run dev:demo): no API, database or sign-in. Off in every other mode.
      'import.meta.env.VITE_DEMO_MODE': JSON.stringify(mode === 'demo' ? 'true' : ''),
    },
  };
});
