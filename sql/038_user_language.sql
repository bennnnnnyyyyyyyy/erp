-- 038_user_language.sql
-- A person's own display language, saved on their ACCOUNT so it follows them to another browser or device (before this it was kept
-- only in the browser, lib/i18n.tsx). English or Arabic, or none (follow the company default). Nothing is forced: it is only a default
-- the person can change at any time (Settings > General, the switch on the tutorial and Guide pages, the first-choice card).
--
-- Why this table has no org_id: it is about the person, not about a company's business data, and one person can belong to several
-- companies; their language should be the same in all of them. It holds one row per signed-in user and nothing else, so the
-- multi-tenancy rule "every business table has org_id" does not apply. The isolation rule still does: a person can read only their own
-- row (row level security), and writes go only through the function below (ADR-0003). Not audited on purpose: a display preference is
-- not a business record and audit_log rows are per organization.
-- Depends on sql/001. Rerun-safe. Run the whole file, then sql/tests/032_user_language.sql.

begin;

create table if not exists public.user_preferences (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  language   text check (language is null or language in ('en', 'ar')),
  updated_at timestamptz not null default now()
);

alter table public.user_preferences enable row level security;
revoke all on public.user_preferences from anon, authenticated;
grant select on public.user_preferences to authenticated;
drop policy if exists user_preferences_own_read on public.user_preferences;
create policy user_preferences_own_read on public.user_preferences for select to authenticated using (user_id = auth.uid());

-- Save (or clear, with null) the signed-in person's language.
create or replace function public.core_set_my_language(p_language text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'FORBIDDEN'; end if;
  if p_language is not null and p_language not in ('en', 'ar') then raise exception 'INVALID_INPUT' using detail = 'language must be en or ar'; end if;
  insert into public.user_preferences (user_id, language) values (auth.uid(), p_language)
  on conflict (user_id) do update set language = excluded.language, updated_at = now();
end $$;

revoke all on function public.core_set_my_language(text) from public, anon;
grant execute on function public.core_set_my_language(text) to authenticated;

commit;

-- Verification (read-only): RLS on (true), users can call the function (true), anonymous cannot (false).
select (select relrowsecurity from pg_class where oid = 'public.user_preferences'::regclass) as rls_on,
       has_function_privilege('authenticated', 'public.core_set_my_language(text)', 'execute') as users_can_set,
       has_function_privilege('anon', 'public.core_set_my_language(text)', 'execute') as anon_can_set;
