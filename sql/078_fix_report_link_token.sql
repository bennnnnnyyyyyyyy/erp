-- 078_fix_report_link_token.sql
-- Fix for sql/070: core_create_report_link makes its token with pgcrypto's gen_random_bytes, which Supabase installs in the
-- `extensions` schema, but the function's search_path was only `public`, so creating a link failed with "function
-- gen_random_bytes(integer) does not exist" (found by the SQL tests in CI on PR #39; the local test database had pgcrypto in public).
-- Same setting as the other functions that use it (sql/054 Telegram). Nothing else changes. Rerun-safe.

begin;

alter function public.core_create_report_link(text, text, int) set search_path = public, extensions;

commit;

-- Read-only verification: the function's settings now include the extensions schema.
select proconfig from pg_proc where oid = 'public.core_create_report_link(text, text, int)'::regprocedure;
