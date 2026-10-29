-- 004_revoke_extra_privileges.sql
-- Found while verifying sql/003 (query 3b, 2026-10-29): `authenticated` still held REFERENCES, TRIGGER and
-- TRUNCATE on organizations, memberships, org_modules and audit_log. sql/001 only revoked INSERT, UPDATE and
-- DELETE. TRUNCATE is not covered by row level security or by the audit_log update/delete trigger, so it must
-- be removed, and refused on audit_log as a second line.
--
-- Depends on sql/001. Rerun-safe: revokes are idempotent, the trigger is dropped and recreated by name.
-- No table or data is dropped. Run the whole file in the Supabase SQL Editor with nothing selected, then run
-- each verification query on its own. NOT YET RUN.

begin;

-- Signed-in users and anonymous visitors keep only SELECT (anon keeps nothing), on the four core tables.
revoke truncate, references, trigger on public.organizations, public.memberships, public.org_modules, public.audit_log from anon, authenticated;

-- The audit log refuses TRUNCATE for everyone, including the table owner.
create or replace function public.audit_log_no_truncate() returns trigger
language plpgsql set search_path = public as $$
begin
  raise exception 'audit_log is append-only (TRUNCATE refused)';
end $$;

drop trigger if exists audit_log_no_truncate on public.audit_log;
create trigger audit_log_no_truncate before truncate on public.audit_log
  for each statement execute function public.audit_log_no_truncate();

-- Tables created later in the public schema by this role should not hand these rights out by default.
alter default privileges in schema public revoke truncate, references, trigger on tables from anon, authenticated;

commit;

-- ---------------------------------------------------------------- verification (read-only; run each on its own)

-- 1. Signed-in and anonymous roles hold nothing but SELECT on the core tables (expect zero rows).
select grantee, table_name, privilege_type from information_schema.role_table_grants
where grantee in ('anon', 'authenticated') and table_schema = 'public'
  and table_name in ('organizations', 'memberships', 'org_modules', 'audit_log')
  and privilege_type <> 'SELECT'
order by 1, 2, 3;

-- 2. Triggers on audit_log (expect audit_log_append_only, audit_log_chain, audit_log_no_truncate).
select tgname from pg_trigger where tgrelid = 'public.audit_log'::regclass and not tgisinternal order by tgname;
