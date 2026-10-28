-- 001_tenancy_core.sql
-- Multi-tenant foundation: organizations, memberships, per-org modules, append-only audit log.
--
-- Rerun-safe: tables use `if not exists`, functions `create or replace`. Policies and
-- triggers are dropped and recreated by name so a rerun picks up edits; no table or data
-- is ever dropped. Run the whole file in the Supabase SQL Editor with nothing selected,
-- then run the verification queries at the bottom and save their output.

begin;

-- ---------------------------------------------------------------- helpers

create or replace function public.set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ---------------------------------------------------------------- organizations

create table if not exists public.organizations (
  id               uuid primary key default gen_random_uuid(),
  name             text not null check (length(trim(name)) between 1 and 200),
  slug             text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  default_currency char(3) not null default 'USD' check (default_currency ~ '^[A-Z]{3}$'),
  timezone         text not null default 'UTC',
  settings         jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz
);

drop trigger if exists organizations_updated_at on public.organizations;
create trigger organizations_updated_at before update on public.organizations
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------- memberships

create table if not exists public.memberships (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id),
  user_id     uuid not null references auth.users(id),
  role        text not null default 'member' check (role in ('owner', 'admin', 'member', 'viewer')),
  invited_by  uuid references auth.users(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  disabled_at timestamptz,
  unique (org_id, user_id)
);

create index if not exists memberships_user_idx on public.memberships (user_id) where disabled_at is null;

drop trigger if exists memberships_updated_at on public.memberships;
create trigger memberships_updated_at before update on public.memberships
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------- org_modules

-- Which optional modules an organization has switched on. Core modules are always on and
-- need no row. `module_key` matches packages/shared/src/modules.ts.
create table if not exists public.org_modules (
  org_id      uuid not null references public.organizations(id),
  module_key  text not null check (module_key ~ '^[a-z][a-z0-9_]{1,40}$'),
  enabled_at  timestamptz not null default now(),
  enabled_by  uuid references auth.users(id),
  disabled_at timestamptz,
  primary key (org_id, module_key)
);

-- ---------------------------------------------------------------- audit_log

create table if not exists public.audit_log (
  id            bigint generated always as identity primary key,
  org_id        uuid not null references public.organizations(id),
  occurred_at   timestamptz not null default now(),
  actor_user_id uuid references auth.users(id),
  action        text not null,
  entity_type   text not null,
  entity_id     text,
  summary       text,
  before        jsonb,
  after         jsonb,
  metadata      jsonb not null default '{}'::jsonb
);

create index if not exists audit_log_org_time_idx on public.audit_log (org_id, occurred_at desc);
create index if not exists audit_log_entity_idx on public.audit_log (org_id, entity_type, entity_id);

create or replace function public.audit_log_is_append_only() returns trigger
language plpgsql as $$
begin
  raise exception 'audit_log is append-only (% refused)', tg_op;
end $$;

drop trigger if exists audit_log_append_only on public.audit_log;
create trigger audit_log_append_only before update or delete on public.audit_log
  for each statement execute function public.audit_log_is_append_only();

-- ---------------------------------------------------------------- membership helper

-- True when the signed-in user is an active member of the organization. Security definer
-- so RLS policies can call it without recursing into the memberships policy.
create or replace function public.is_org_member(p_org_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.memberships m
    join public.organizations o on o.id = m.org_id
    where m.org_id = p_org_id
      and m.user_id = auth.uid()
      and m.disabled_at is null
      and o.deleted_at is null
  );
$$;

revoke all on function public.is_org_member(uuid) from public, anon;
grant execute on function public.is_org_member(uuid) to authenticated;

-- ---------------------------------------------------------------- row level security
-- The API uses the service-role key (bypasses RLS) and scopes by org_id itself. These
-- policies cover the browser's direct reads (the organization picker) and are the safety
-- net if any other client ever talks to the database.

alter table public.organizations enable row level security;
alter table public.memberships   enable row level security;
alter table public.org_modules   enable row level security;
alter table public.audit_log     enable row level security;

revoke all on public.organizations, public.memberships, public.org_modules, public.audit_log from anon;
revoke insert, update, delete on public.organizations, public.memberships, public.org_modules, public.audit_log from authenticated;
grant select on public.organizations, public.memberships, public.org_modules, public.audit_log to authenticated;

drop policy if exists organizations_member_read on public.organizations;
create policy organizations_member_read on public.organizations
  for select to authenticated using (deleted_at is null and public.is_org_member(id));

drop policy if exists memberships_own_read on public.memberships;
create policy memberships_own_read on public.memberships
  for select to authenticated using (user_id = auth.uid());

drop policy if exists org_modules_member_read on public.org_modules;
create policy org_modules_member_read on public.org_modules
  for select to authenticated using (public.is_org_member(org_id));

drop policy if exists audit_log_member_read on public.audit_log;
create policy audit_log_member_read on public.audit_log
  for select to authenticated using (public.is_org_member(org_id));

-- ---------------------------------------------------------------- bootstrap

-- Creates an organization and makes an existing Supabase Auth user its owner, with an
-- audit row. Service role only. Refuses a slug that is taken or an unknown email.
create or replace function public.bootstrap_organization(p_name text, p_slug text, p_owner_email text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_user_id uuid;
  v_org_id  uuid;
begin
  select id into v_user_id from auth.users where lower(email) = lower(p_owner_email);
  if v_user_id is null then
    raise exception 'No Supabase Auth user with email %. Create the user first (Authentication > Users).', p_owner_email;
  end if;
  if exists (select 1 from public.organizations where slug = p_slug) then
    raise exception 'An organization with slug % already exists', p_slug;
  end if;

  insert into public.organizations (name, slug) values (p_name, p_slug) returning id into v_org_id;
  insert into public.memberships (org_id, user_id, role) values (v_org_id, v_user_id, 'owner');
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary)
  values (v_org_id, v_user_id, 'organization.created', 'organization', v_org_id::text,
          format('Organization %s created with %s as owner', p_name, p_owner_email));
  return v_org_id;
end $$;

revoke all on function public.bootstrap_organization(text, text, text) from public, anon, authenticated;

commit;

-- ---------------------------------------------------------------- verification (read-only)

-- 1. Four tables exist with RLS on.
select relname, relrowsecurity
from pg_class
where relnamespace = 'public'::regnamespace
  and relname in ('organizations', 'memberships', 'org_modules', 'audit_log')
order by relname;

-- 2. Policies in place (expect one per table).
select tablename, policyname, cmd from pg_policies
where schemaname = 'public' and tablename in ('organizations', 'memberships', 'org_modules', 'audit_log')
order by tablename;

-- 3. anon has no table privileges (expect zero rows).
select table_name, privilege_type from information_schema.role_table_grants
where grantee = 'anon' and table_schema = 'public'
  and table_name in ('organizations', 'memberships', 'org_modules', 'audit_log');

-- 4. Append-only trigger present.
select tgname from pg_trigger where tgrelid = 'public.audit_log'::regclass and not tgisinternal;
