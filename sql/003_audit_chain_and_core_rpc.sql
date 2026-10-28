-- 003_audit_chain_and_core_rpc.sql
-- ADR-0003: audit v2 (per-organization hash chain) and the first database functions that the API
-- calls with the signed-in user's own JWT, so the change and its audit row commit together.
--
-- Depends on sql/001. Rerun-safe: columns/indexes `if not exists`, functions `create or replace`,
-- triggers dropped and recreated by name. No table or data is dropped. Run the whole file in the
-- Supabase SQL Editor with nothing selected, then the verification queries at the bottom.
--
-- NOT YET RUN against any database. Review, run on a staging project first, and log in the worklog.

begin;

-- ---------------------------------------------------------------- audit_log: chain columns

alter table public.audit_log add column if not exists seq        bigint;
alter table public.audit_log add column if not exists prev_hash  text;
alter table public.audit_log add column if not exists hash       text;
alter table public.audit_log add column if not exists channel    text not null default 'api';
alter table public.audit_log add column if not exists request_id text;

create unique index if not exists audit_log_org_seq_uidx on public.audit_log (org_id, seq) where seq is not null;

-- Hash of one row's content plus the previous row's hash. `hash` itself is not an input.
create or replace function public.audit_row_hash(r public.audit_log) returns text
language sql stable set search_path = public as $$
  select encode(sha256(convert_to(concat_ws('|',
    coalesce(r.prev_hash, ''),
    r.org_id::text,
    r.seq::text,
    to_char(r.occurred_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.US'),
    coalesce(r.actor_user_id::text, ''),
    r.action,
    r.entity_type,
    coalesce(r.entity_id, ''),
    coalesce(r.summary, ''),
    coalesce(r.before::text, ''),
    coalesce(r.after::text, ''),
    r.metadata::text,
    r.channel,
    coalesce(r.request_id, '')
  ), 'UTF8')), 'hex');
$$;

-- Assigns the next sequence number and links to the previous hash. The advisory lock serializes
-- inserts per organization so two concurrent writers cannot fork the chain.
create or replace function public.audit_log_chain() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_seq  bigint;
  v_prev text;
begin
  perform pg_advisory_xact_lock(hashtextextended(new.org_id::text, 0));
  select a.seq, a.hash into v_seq, v_prev
  from public.audit_log a
  where a.org_id = new.org_id and a.seq is not null
  order by a.seq desc
  limit 1;
  new.seq := coalesce(v_seq, 0) + 1;
  new.prev_hash := v_prev;
  new.hash := public.audit_row_hash(new);
  return new;
end $$;

drop trigger if exists audit_log_chain on public.audit_log;
create trigger audit_log_chain before insert on public.audit_log
  for each row execute function public.audit_log_chain();

-- Recomputes an organization's chain. Returns no rows when it is intact, otherwise the first bad
-- sequence number and why. Service role only (scheduled job / admin).
create or replace function public.audit_verify(p_org_id uuid)
returns table (first_bad_seq bigint, reason text)
language plpgsql stable security definer set search_path = public as $$
declare
  r          public.audit_log;
  v_prev     text := null;
  v_expected bigint := 1;
begin
  for r in select * from public.audit_log where org_id = p_org_id and seq is not null order by seq loop
    if r.seq <> v_expected then
      return query select r.seq, 'sequence gap'::text; return;
    end if;
    if r.prev_hash is distinct from v_prev then
      return query select r.seq, 'previous hash mismatch'::text; return;
    end if;
    if r.hash is distinct from public.audit_row_hash(r) then
      return query select r.seq, 'row hash mismatch'::text; return;
    end if;
    v_prev := r.hash;
    v_expected := v_expected + 1;
  end loop;
end $$;

-- Audit rows for events that are not database changes (login, export) and for the API's admin
-- paths (member invites). Service role only: signed-in users must never be able to write audit
-- rows directly, or they could forge history.
create or replace function public.audit_append_admin(
  p_org_id uuid, p_actor uuid, p_action text, p_entity_type text,
  p_entity_id text default null, p_summary text default null,
  p_before jsonb default null, p_after jsonb default null, p_metadata jsonb default '{}'::jsonb,
  p_channel text default 'api', p_request_id text default null
) returns bigint
language plpgsql security definer set search_path = public as $$
declare v_id bigint;
begin
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary, before, after, metadata, channel, request_id)
  values (p_org_id, p_actor, p_action, p_entity_type, p_entity_id, p_summary, p_before, p_after, coalesce(p_metadata, '{}'::jsonb), p_channel, p_request_id)
  returning id into v_id;
  return v_id;
end $$;

-- ---------------------------------------------------------------- request context

-- The organization the caller is acting in: the `X-Org-Id` request header (PostgREST exposes it as
-- `request.headers`), accepted only if the signed-in user is an active member. The header is a
-- request for an organization, never proof of access; membership is checked here every call.
create or replace function public.current_org_id() returns uuid
language plpgsql stable security definer set search_path = public as $$
declare
  v_hdr text;
  v_org uuid;
begin
  begin
    v_hdr := (current_setting('request.headers', true)::json) ->> 'x-org-id';
  exception when others then
    v_hdr := null;
  end;
  if v_hdr is null or v_hdr !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'ORG_REQUIRED';
  end if;
  v_org := v_hdr::uuid;
  if not public.is_org_member(v_org) then
    raise exception 'NOT_A_MEMBER';
  end if;
  return v_org;
end $$;

-- Returns the caller's organization id after checking their role there. Internal helper for the
-- functions below; not callable from the browser.
create or replace function public.require_org_role(p_roles text[]) returns uuid
language plpgsql stable security definer set search_path = public as $$
declare
  v_org  uuid := public.current_org_id();
  v_role text;
begin
  select m.role into v_role
  from public.memberships m
  where m.org_id = v_org and m.user_id = auth.uid() and m.disabled_at is null;
  if v_role is null or not (v_role = any (p_roles)) then
    raise exception 'FORBIDDEN';
  end if;
  return v_org;
end $$;

-- ---------------------------------------------------------------- core functions (change + audit, one transaction)

create or replace function public.core_set_module(p_module_key text, p_enabled boolean) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.require_org_role(array['owner', 'admin']);
begin
  if p_module_key is null or p_module_key !~ '^[a-z][a-z0-9_]{1,40}$' then
    raise exception 'INVALID_INPUT';
  end if;

  insert into public.org_modules (org_id, module_key, enabled_at, enabled_by, disabled_at)
  values (v_org, p_module_key, now(), auth.uid(), case when p_enabled then null else now() end)
  on conflict (org_id, module_key) do update set
    enabled_by  = auth.uid(),
    enabled_at  = case when p_enabled then now() else public.org_modules.enabled_at end,
    disabled_at = case when p_enabled then null else now() end;

  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary)
  values (v_org, auth.uid(),
          case when p_enabled then 'module.enabled' else 'module.disabled' end,
          'module', p_module_key,
          format('%s switched %s', p_module_key, case when p_enabled then 'on' else 'off' end));
end $$;

-- Partial update: a null argument leaves that setting unchanged. Returns the settings after the change.
create or replace function public.core_update_org(
  p_name text default null, p_default_currency text default null,
  p_timezone text default null, p_date_format text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_org    uuid := public.require_org_role(array['owner', 'admin']);
  v_before jsonb;
  v_after  jsonb;
begin
  if p_name is not null and length(trim(p_name)) not between 1 and 200 then raise exception 'INVALID_INPUT'; end if;
  if p_default_currency is not null and upper(p_default_currency) !~ '^[A-Z]{3}$' then raise exception 'INVALID_INPUT'; end if;
  if p_timezone is not null then
    perform (now() at time zone p_timezone); -- raises for an unknown zone
  end if;
  if p_date_format is not null and p_date_format not in ('DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD') then raise exception 'INVALID_INPUT'; end if;

  select jsonb_build_object('id', o.id, 'name', o.name, 'slug', o.slug, 'defaultCurrency', o.default_currency,
                            'timezone', o.timezone, 'dateFormat', coalesce(o.settings ->> 'date_format', 'DD/MM/YYYY'))
  into v_before from public.organizations o where o.id = v_org;

  update public.organizations o set
    name             = coalesce(trim(p_name), o.name),
    default_currency = coalesce(upper(p_default_currency), o.default_currency),
    timezone         = coalesce(p_timezone, o.timezone),
    settings         = case when p_date_format is not null
                            then o.settings || jsonb_build_object('date_format', p_date_format)
                            else o.settings end
  where o.id = v_org;

  select jsonb_build_object('id', o.id, 'name', o.name, 'slug', o.slug, 'defaultCurrency', o.default_currency,
                            'timezone', o.timezone, 'dateFormat', coalesce(o.settings ->> 'date_format', 'DD/MM/YYYY'))
  into v_after from public.organizations o where o.id = v_org;

  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary, before, after)
  values (v_org, auth.uid(), 'organization.updated', 'organization', v_org::text, 'Organization settings changed', v_before, v_after);

  return v_after;
end $$;

-- ---------------------------------------------------------------- privileges

revoke all on function public.audit_row_hash(public.audit_log) from public, anon, authenticated;
revoke all on function public.audit_log_chain() from public, anon, authenticated;
revoke all on function public.audit_verify(uuid) from public, anon, authenticated;
revoke all on function public.audit_append_admin(uuid, uuid, text, text, text, text, jsonb, jsonb, jsonb, text, text) from public, anon, authenticated;
revoke all on function public.current_org_id() from public, anon;
revoke all on function public.require_org_role(text[]) from public, anon, authenticated;
revoke all on function public.core_set_module(text, boolean) from public, anon;
revoke all on function public.core_update_org(text, text, text, text) from public, anon;

grant execute on function public.audit_verify(uuid) to service_role;
grant execute on function public.audit_append_admin(uuid, uuid, text, text, text, text, jsonb, jsonb, jsonb, text, text) to service_role;
grant execute on function public.current_org_id() to authenticated;
grant execute on function public.core_set_module(text, boolean) to authenticated;
grant execute on function public.core_update_org(text, text, text, text) to authenticated;

commit;

-- ---------------------------------------------------------------- verification (read-only)

-- 1. Chain trigger present (expect audit_log_append_only and audit_log_chain).
select tgname from pg_trigger where tgrelid = 'public.audit_log'::regclass and not tgisinternal order by tgname;

-- 2. Browser roles cannot call the internal/admin functions (expect false for anon and authenticated,
--    true for service_role on audit_append_admin and audit_verify).
select r.rolname,
       has_function_privilege(r.rolname, 'public.audit_append_admin(uuid,uuid,text,text,text,text,jsonb,jsonb,jsonb,text,text)', 'execute') as append_admin,
       has_function_privilege(r.rolname, 'public.audit_verify(uuid)', 'execute') as verify,
       has_function_privilege(r.rolname, 'public.require_org_role(text[])', 'execute') as require_role
from pg_roles r where r.rolname in ('anon', 'authenticated', 'service_role') order by r.rolname;

-- 3. Signed-in users still have no direct write access to the tables the functions change
--    (expect zero rows).
select table_name, privilege_type from information_schema.role_table_grants
where grantee in ('anon', 'authenticated') and table_schema = 'public'
  and table_name in ('organizations', 'memberships', 'org_modules', 'audit_log')
  and privilege_type in ('INSERT', 'UPDATE', 'DELETE');

-- 4. Every existing organization's audit chain is intact (expect zero rows).
select o.id as org_id, v.first_bad_seq, v.reason
from public.organizations o cross join lateral public.audit_verify(o.id) v;
