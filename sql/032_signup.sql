-- 032_signup.sql
-- Sign-up: a person with a confirmed Supabase Auth account creates their own company. Until now organizations could only be
-- created by us (bootstrap_organization is service-role only). `core_create_organization` is the one safe door for it:
--   * the caller must be signed in and have a CONFIRMED email (no throw-away accounts creating companies);
--   * one person can own at most 3 companies (a simple brake on abuse; raise it by migration when there is a reason);
--   * name, language (en/ar), currency (ISO 4217) and time zone are validated; the slug is made from the name and made unique;
--   * the caller becomes the OWNER, every shipped app is switched on (sql/021 pattern), the language is stored (sql/031), and the
--     company is flagged `show_tutorial` so its "Getting started" tutorial shows (sample companies never have the flag);
--   * it is audited ("organization.created" by bootstrap, plus "organization.setup" with the choices made).
-- `core_set_tutorial` lets an owner or admin hide or show the tutorial again. Money, stock and every other table are untouched.
-- Depends on sql/001-031. Rerun-safe. Then run sql/tests/028_signup.sql.

begin;

create or replace function public.core_create_organization(
  p_name text, p_language text default 'en', p_currency text default 'EGP', p_timezone text default 'Africa/Cairo'
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_email text; v_confirmed timestamptz;
  v_name text := trim(coalesce(p_name, ''));
  v_base text; v_slug text; v_org uuid; v_n int; v_try int := 0;
begin
  if v_user is null then raise exception 'NOT_SIGNED_IN'; end if;
  select u.email, u.email_confirmed_at into v_email, v_confirmed from auth.users u where u.id = v_user;
  if v_email is null then raise exception 'NOT_SIGNED_IN'; end if;
  if v_confirmed is null then raise exception 'EMAIL_NOT_CONFIRMED'; end if;

  if length(v_name) < 2 or length(v_name) > 120 then raise exception 'INVALID_INPUT'; end if;
  if p_language is null or p_language not in ('en', 'ar') then raise exception 'INVALID_INPUT'; end if;
  if p_currency is null or upper(p_currency) !~ '^[A-Z]{3}$' then raise exception 'INVALID_INPUT'; end if;
  begin
    perform (now() at time zone p_timezone);          -- raises for an unknown zone
  exception when others then raise exception 'INVALID_INPUT';
  end;

  select count(*) into v_n from public.memberships m
   join public.organizations o on o.id = m.org_id and o.deleted_at is null
   where m.user_id = v_user and m.role = 'owner' and m.disabled_at is null;
  if v_n >= 3 then raise exception 'LIMIT_REACHED'; end if;

  v_base := trim(both '-' from regexp_replace(lower(v_name), '[^a-z0-9]+', '-', 'g'));
  if v_base = '' then v_base := 'company'; end if;
  v_base := left(v_base, 40);
  v_slug := v_base;
  while exists (select 1 from public.organizations where slug = v_slug) loop
    v_try := v_try + 1;
    if v_try > 20 then raise exception 'INVALID_INPUT'; end if;
    v_slug := v_base || '-' || substr(md5(random()::text || clock_timestamp()::text), 1, 4);
  end loop;

  v_org := public.bootstrap_organization(v_name, v_slug, v_email);
  update public.organizations o
     set default_currency = upper(p_currency), timezone = p_timezone,
         settings = coalesce(o.settings, '{}'::jsonb) || jsonb_build_object('language', p_language, 'show_tutorial', true)
   where o.id = v_org;
  perform public.core_enable_all_modules(v_org);
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary, metadata)
  values (v_org, v_user, 'organization.setup', 'organization', v_org::text, format('Company set up: language %s, currency %s, time zone %s', p_language, upper(p_currency), p_timezone),
          jsonb_build_object('language', p_language, 'currency', upper(p_currency), 'timezone', p_timezone));
  return v_org;
end $$;

create or replace function public.core_set_tutorial(p_show boolean) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.require_org_role(array['owner', 'admin']); v_before boolean;
begin
  if p_show is null then raise exception 'INVALID_INPUT'; end if;
  select coalesce((o.settings ->> 'show_tutorial')::boolean, false) into v_before from public.organizations o where o.id = v_org;
  if v_before = p_show then return p_show; end if;
  update public.organizations o set settings = coalesce(o.settings, '{}'::jsonb) || jsonb_build_object('show_tutorial', p_show) where o.id = v_org;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary)
  values (v_org, auth.uid(), 'organization.tutorial_changed', 'organization', v_org::text, case when p_show then 'Getting-started tutorial shown' else 'Getting-started tutorial hidden' end);
  return p_show;
end $$;

revoke all on function public.core_create_organization(text, text, text, text), public.core_set_tutorial(boolean) from public, anon;
grant execute on function public.core_create_organization(text, text, text, text), public.core_set_tutorial(boolean) to authenticated;

commit;

-- Verification (read-only): signed-in users can call both, anonymous cannot (expect true, false).
select has_function_privilege('authenticated', 'public.core_create_organization(text,text,text,text)', 'execute') as authenticated_can,
       has_function_privilege('anon', 'public.core_create_organization(text,text,text,text)', 'execute') as anon_can;
