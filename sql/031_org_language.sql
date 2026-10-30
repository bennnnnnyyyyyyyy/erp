-- 031_org_language.sql
-- Language is ONE setting for the whole organization (Ben, 2026-10-30): everyone in the company sees the same language and text
-- direction, chosen when the company signs up and changeable later by an owner or admin. Stored with the other organization settings
-- (organizations.settings ->> 'language': 'en' or 'ar'; missing means 'en'). No per-person or per-browser language any more.
-- Depends on sql/001-030. Rerun-safe. Then run sql/tests/027_org_language.sql.

begin;

create or replace function public.core_set_language(p_language text) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_org    uuid := public.require_org_role(array['owner', 'admin']);
  v_before text;
begin
  if p_language is null or p_language not in ('en', 'ar') then raise exception 'INVALID_INPUT'; end if;
  select coalesce(o.settings ->> 'language', 'en') into v_before from public.organizations o where o.id = v_org;
  if v_before = p_language then return p_language; end if;           -- nothing to change, nothing to audit
  update public.organizations o set settings = coalesce(o.settings, '{}'::jsonb) || jsonb_build_object('language', p_language) where o.id = v_org;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary, before, after)
  values (v_org, auth.uid(), 'organization.language_changed', 'organization', v_org::text, format('Language changed from %s to %s', v_before, p_language),
          jsonb_build_object('language', v_before), jsonb_build_object('language', p_language));
  return p_language;
end $$;

revoke all on function public.core_set_language(text) from public, anon;
grant execute on function public.core_set_language(text) to authenticated;

commit;

-- Verification (read-only): signed-in users may call it, anonymous may not (expect true, false).
select has_function_privilege('authenticated', 'public.core_set_language(text)', 'execute') as authenticated_can, has_function_privilege('anon', 'public.core_set_language(text)', 'execute') as anon_can;
