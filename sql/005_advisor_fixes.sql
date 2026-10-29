-- 005_advisor_fixes.sql
-- Fixes from the Supabase advisors report (`supabase db advisors --linked`, 2026-10-29):
--   * function_search_path_mutable: set_updated_at, audit_log_is_append_only, audit_log_no_truncate had no pinned search_path.
--   * auth_rls_initplan: policy memberships_own_read called auth.uid() once per row; wrapping it in (select ...) makes it once per query.
-- Behaviour does not change. Rerun-safe: ALTER FUNCTION ... SET is idempotent, the policy is dropped and recreated by name.
-- No table or data is dropped. Run the whole file, then the verification queries (each on its own).

begin;

alter function public.set_updated_at() set search_path = public;
alter function public.audit_log_is_append_only() set search_path = public;
alter function public.audit_log_no_truncate() set search_path = public;

drop policy if exists memberships_own_read on public.memberships;
create policy memberships_own_read on public.memberships
  for select to authenticated using (user_id = (select auth.uid()));

commit;

-- ---------------------------------------------------------------- verification (read-only)

-- 1. The three functions now have a pinned search_path (expect three rows, each with a proconfig value).
select proname, proconfig from pg_proc
where pronamespace = 'public'::regnamespace and proname in ('set_updated_at', 'audit_log_is_append_only', 'audit_log_no_truncate')
order by proname;

-- 2. The memberships policy uses the wrapped call (expect one row whose qual contains "SELECT auth.uid()").
select policyname, qual from pg_policies where schemaname = 'public' and tablename = 'memberships';
