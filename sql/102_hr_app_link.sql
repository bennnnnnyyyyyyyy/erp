-- 102_hr_app_link.sql
-- HR & payroll app link, phase 1 (documentation/plans/HR_APP_INTEGRATION_PLAN.md; contract documentation/plans/hr-app/CONTRACT.md).
-- Ben's decisions, 20 Nov 2026: the HR app is an outside provider on Settings > Integrations, like Shopify; v1 connects with a
-- per-company ERP key (OAuth later); the ERP reads branches, departments and employees every 15 minutes and when a signed webhook
-- or "Sync now" asks; every member sees a staff directory, owners and admins also see work emails, ERP links and dates.
--   * Provider 'hr_app': fields base_url (plain, https only) and api_key (secret, Vault). The ERP registers its own webhook with the
--     HR app; the signing secret it gets back is kept in the same Vault bundle (never shown). settings.hr_connection_id is our own
--     reference for webhooks (unique across companies).
--   * hr_units (branches and departments), hr_employees: read-only copies, keyed by the HR app's ids; written only by the sync
--     (service role). Links to other HR records are kept as the HR app's ids and resolved when read.
--   * hr_sync_state (one row per company), hr_webhook_events (event ids, 7 days, for replays; never the body).
--   * Users: hr_directory (members: directory; owners and admins: details and link suggestions), hr_request_sync,
--     hr_link_employee / hr_unlink_employee, hr_map_branch. All audited.
--   * Service role: hr__sync_due, hr__begin_sync, hr__apply_units, hr__apply_employees, hr__finish_sync, hr__save_subscription,
--     hr__accept_webhook, hr__record_webhook.
-- core_integrations kind check, core__provider_fields (from sql/082), core_save_provider_fields (from sql/056) and
-- core_save_integration (from sql/082) are recreated from their latest versions with only the hr_app additions.
-- Depends on sql/001-101. Rerun-safe. Then run sql/tests/099_hr_app_link.sql.

begin;

-- ---------------------------------------------------------------- provider registration

alter table public.core_integrations drop constraint if exists core_integrations_kind_check;
alter table public.core_integrations add constraint core_integrations_kind_check check (kind in
  ('email', 'slack', 'teams', 'telegram', 'google_chat', 'paymob', 'fawry', 'bosta', 'shopify', 'openai', 'elevenlabs', 'ollama', 'hr_app'));

-- sql/082's list plus hr_app.
create or replace function public.core__provider_fields(p_kind text)
returns table (field text, is_secret boolean, required boolean)
language sql immutable as $$
  select v.field, v.is_secret, v.required from (values
    ('paymob', 'secret_key', true, true), ('paymob', 'public_key', true, true), ('paymob', 'hmac_secret', true, true),
    ('paymob', 'integration_ids', false, true),
    ('fawry', 'merchant_code', false, true), ('fawry', 'secure_key', true, true),
    ('bosta', 'api_key', true, true), ('bosta', 'webhook_secret', true, true),
    ('shopify', 'shop_domain', false, true), ('shopify', 'client_id', false, true), ('shopify', 'webhook_secret', true, true),
    ('shopify', 'access_token', true, false), ('shopify', 'warehouse_code', false, false),
    ('openai', 'api_key', true, false), ('openai', 'model', false, false),
    ('elevenlabs', 'api_key', true, false),
    ('ollama', 'base_url', false, true), ('ollama', 'model', false, true), ('ollama', 'api_key', true, false),
    ('hr_app', 'base_url', false, true), ('hr_app', 'api_key', true, true)
  ) v(kind, field, is_secret, required) where v.kind = p_kind;
$$;
revoke all on function public.core__provider_fields(text) from public, anon, authenticated;

create unique index if not exists core_integrations_hr_connection_once
  on public.core_integrations ((settings ->> 'hr_connection_id'))
  where kind = 'hr_app' and coalesce(settings ->> 'hr_connection_id', '') <> '';

-- sql/056's function plus, for hr_app: an https address without credentials or query; our connection id made once; a changed
-- address or key drops the webhook registration (the sync registers it again with the new details).
create or replace function public.core_save_provider_fields(p_kind text, p_values jsonb) returns jsonb
language plpgsql security definer set search_path = public, vault, extensions as $$
declare
  v_org uuid := public.require_org_role(array['owner', 'admin']); r public.core_integrations; f record; k text; v text;
  v_bundle jsonb := '{}'::jsonb; v_config jsonb; v_saved text[]; v_sid uuid; v_settings jsonb;
begin
  if not exists (select 1 from public.core__provider_fields(p_kind)) or jsonb_typeof(p_values) <> 'object' then
    raise exception 'INVALID_INPUT' using detail = 'unknown provider';
  end if;
  for k in select jsonb_object_keys(p_values) loop
    if not exists (select 1 from public.core__provider_fields(p_kind) x where x.field = k) then raise exception 'INVALID_INPUT' using detail = format('unknown field %s', k); end if;
    if jsonb_typeof(p_values -> k) <> 'string' or length(p_values ->> k) > 4000 then raise exception 'INVALID_INPUT' using detail = format('%s must be text', k); end if;
  end loop;
  if p_kind = 'ollama' and coalesce(p_values ->> 'base_url', 'https://x') !~ '^https?://[^\s]+$' then raise exception 'INVALID_INPUT' using detail = 'base_url must start with http:// or https://'; end if;
  if p_kind = 'shopify' and p_values ? 'shop_domain' and p_values ->> 'shop_domain' !~ '^[a-z0-9][a-z0-9-]*\.myshopify\.com$' then
    raise exception 'INVALID_INPUT' using detail = 'shop_domain looks like your-store.myshopify.com';
  end if;
  if p_kind = 'hr_app' and coalesce(trim(p_values ->> 'base_url'), '') <> ''
     and trim(p_values ->> 'base_url') !~ '^https://[A-Za-z0-9.-]+(:[0-9]{1,5})?(/[A-Za-z0-9._~/-]*)?$' then
    raise exception 'INVALID_INPUT' using detail = 'the HR app address starts with https:// (no user name, password or query)';
  end if;

  insert into public.core_integrations (org_id, kind, updated_by) values (v_org, p_kind, auth.uid()) on conflict (org_id, kind) do nothing;
  select * into r from public.core_integrations where org_id = v_org and kind = p_kind for update;
  if r.secret_id is not null then
    select coalesce(nullif(d.decrypted_secret, '')::jsonb, '{}'::jsonb) into v_bundle from vault.decrypted_secrets d where d.id = r.secret_id;
  end if;
  v_config := coalesce(r.settings -> 'config', '{}'::jsonb);
  for f in select * from public.core__provider_fields(p_kind) loop
    continue when not (p_values ? f.field);
    v := trim(p_values ->> f.field);
    if f.is_secret then
      v_bundle := case when v = '' then v_bundle - f.field else v_bundle || jsonb_build_object(f.field, v) end;
    else
      v_config := case when v = '' then v_config - f.field else v_config || jsonb_build_object(f.field, case when p_kind = 'hr_app' and f.field = 'base_url' then rtrim(v, '/') else v end) end;
    end if;
  end loop;
  v_settings := r.settings;
  if p_kind = 'hr_app' then
    if coalesce(v_settings ->> 'hr_connection_id', '') = '' then
      v_settings := v_settings || jsonb_build_object('hr_connection_id',
        'hrc_' || substr(translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/=', ''), 1, 24));
    end if;
    if (p_values ? 'base_url' and (v_config ->> 'base_url') is distinct from (r.settings -> 'config' ->> 'base_url')) or p_values ? 'api_key' then
      v_settings := v_settings - 'hr_subscription_id';
      v_bundle := v_bundle - 'signing_secret';
    end if;
  end if;
  if r.secret_id is null then
    if v_bundle <> '{}'::jsonb then
      v_sid := vault.create_secret(v_bundle::text, format('erp-%s-%s', p_kind, v_org), format('%s credentials for organization %s', p_kind, v_org));
    end if;
  else
    perform vault.update_secret(r.secret_id, v_bundle::text);
    v_sid := r.secret_id;
  end if;
  -- saved_fields: the provider's own fields only (hr_app's signing secret is ours, not a field the person saves)
  select coalesce(array_agg(x order by x), '{}') into v_saved
    from (select jsonb_object_keys(v_bundle) x union select jsonb_object_keys(v_config)) s
   where exists (select 1 from public.core__provider_fields(p_kind) pf where pf.field = s.x);
  update public.core_integrations
     set secret_id = v_sid, secret_hint = case when v_bundle = '{}'::jsonb then null else 'saved' end,
         settings = jsonb_set(jsonb_set(v_settings, '{config}', v_config), '{saved_fields}', to_jsonb(v_saved)),
         updated_by = auth.uid(), last_status = null, last_error = null
   where id = r.id;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary, after)
  values (v_org, auth.uid(), 'core.integration.fields_saved', 'integration', r.id::text, format('%s settings saved (%s)', p_kind, array_to_string(v_saved, ', ')),
          jsonb_build_object('saved_fields', to_jsonb(v_saved)));   -- field names only, never values
  return jsonb_build_object('kind', p_kind, 'savedFields', to_jsonb(v_saved));
end $$;
revoke all on function public.core_save_provider_fields(text, jsonb) from public, anon;
grant execute on function public.core_save_provider_fields(text, jsonb) to authenticated;

-- sql/082's function with 'hr_app' in the list of kinds; nothing else changes.
create or replace function public.core_save_integration(p_kind text, p_enabled boolean, p_mode text, p_kinds text[]) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.require_org_role(array['owner', 'admin']); r public.core_integrations; v_id uuid; v_kinds text[]; v_missing text[];
begin
  if p_kind not in ('email', 'slack', 'teams', 'telegram', 'google_chat', 'paymob', 'fawry', 'bosta', 'shopify', 'openai', 'elevenlabs', 'ollama', 'hr_app')
     or p_enabled is null then raise exception 'INVALID_INPUT'; end if;
  if coalesce(p_mode, 'live') <> 'live' then raise exception 'INVALID_INPUT' using detail = 'test mode was removed; an integration is either off or on'; end if;
  v_kinds := coalesce(p_kinds, '{}');
  if not (v_kinds <@ public.core__integration_kinds()) then raise exception 'INVALID_INPUT' using detail = 'unknown message kind'; end if;
  select * into r from public.core_integrations where org_id = v_org and kind = p_kind for update;
  if p_enabled and p_kind in ('slack', 'teams', 'google_chat') and (r.id is null or r.secret_id is null) then
    raise exception 'INVALID_STATE' using detail = 'save the webhook URL before switching it on';
  end if;
  if p_enabled then
    select array_agg(f.field) into v_missing from public.core__provider_fields(p_kind) f
     where f.required and not coalesce((r.settings -> 'saved_fields') ? f.field, false);
    if v_missing is not null then raise exception 'INVALID_STATE' using detail = format('save %s before switching it on', array_to_string(v_missing, ', ')); end if;
  end if;
  if p_kind in ('openai', 'elevenlabs', 'ollama') and p_enabled and not public.core__ai_consent_current(v_org) then
    raise exception 'INVALID_STATE' using detail = 'the owner must accept the current AI data notice first';
  end if;
  insert into public.core_integrations (org_id, kind, mode, enabled, settings, updated_by)
  values (v_org, p_kind, 'live', p_enabled, jsonb_build_object('kinds', to_jsonb(v_kinds)), auth.uid())
  on conflict (org_id, kind) do update set mode = 'live', enabled = excluded.enabled,
    settings = public.core_integrations.settings || jsonb_build_object('kinds', to_jsonb(v_kinds)), updated_by = auth.uid()
  returning id into v_id;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary, before, after)
  values (v_org, auth.uid(), 'core.integration.changed', 'integration', v_id::text,
          format('%s: %s', p_kind, case when p_enabled then 'on' else 'off' end),
          case when r.id is null then null else jsonb_build_object('enabled', r.enabled, 'kinds', r.settings -> 'kinds') end,
          jsonb_build_object('enabled', p_enabled, 'kinds', to_jsonb(v_kinds)));
  return v_id;
end $$;
revoke all on function public.core_save_integration(text, boolean, text, text[]) from public, anon;
grant execute on function public.core_save_integration(text, boolean, text, text[]) to authenticated;

-- ---------------------------------------------------------------- copies of the HR app's records

create table if not exists public.hr_units (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references public.organizations(id),
  kind               text not null check (kind in ('branch', 'department')),
  external_id        text not null check (length(external_id) between 1 and 64),
  code               text check (code is null or length(code) <= 30),
  name               text not null check (length(trim(name)) between 1 and 120),
  name_ar            text check (name_ar is null or length(name_ar) <= 120),
  branch_external_id text check (branch_external_id is null or length(branch_external_id) <= 64),
  parent_external_id text check (parent_external_id is null or length(parent_external_id) <= 64),
  core_branch_id     uuid,
  active             boolean not null default true,
  source_updated_at  timestamptz not null,
  last_seen_run      uuid,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  deleted_at         timestamptz,
  unique (org_id, id),
  unique (org_id, kind, external_id),
  foreign key (org_id, core_branch_id) references public.core_branches (org_id, id)
);
create index if not exists hr_units_org_idx on public.hr_units (org_id, kind) where deleted_at is null;

create table if not exists public.hr_employees (
  id                     uuid primary key default gen_random_uuid(),
  org_id                 uuid not null references public.organizations(id),
  external_id            text not null check (length(external_id) between 1 and 64),
  employee_number        text check (employee_number is null or length(employee_number) <= 40),
  display_name           text not null check (length(trim(display_name)) between 1 and 160),
  display_name_ar        text check (display_name_ar is null or length(display_name_ar) <= 160),
  work_email             text check (work_email is null or length(work_email) <= 254),
  job_title              text check (job_title is null or length(job_title) <= 120),
  job_title_ar           text check (job_title_ar is null or length(job_title_ar) <= 120),
  branch_external_id     text check (branch_external_id is null or length(branch_external_id) <= 64),
  department_external_id text check (department_external_id is null or length(department_external_id) <= 64),
  manager_external_id    text check (manager_external_id is null or length(manager_external_id) <= 64),
  status                 text not null check (status in ('active', 'on_leave', 'terminated')),
  hired_on               date,
  left_on                date,
  user_id                uuid references auth.users(id),
  link_source            text check (link_source in ('confirmed', 'manual')),
  source_updated_at      timestamptz not null,
  last_seen_run          uuid,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  deleted_at             timestamptz,
  unique (org_id, id),
  unique (org_id, external_id),
  check ((user_id is null) = (link_source is null))
);
create index if not exists hr_employees_org_idx on public.hr_employees (org_id, status) where deleted_at is null;
create unique index if not exists hr_employees_user_once on public.hr_employees (org_id, user_id) where user_id is not null and deleted_at is null;

create table if not exists public.hr_sync_state (
  org_id            uuid primary key references public.organizations(id),
  interval_minutes  int not null default 15 check (interval_minutes between 15 and 1440),
  requested_at      timestamptz,
  last_started_at   timestamptz,
  last_finished_at  timestamptz,
  last_full_at      timestamptz,
  last_result       text check (last_result in ('ok', 'partial', 'failed')),
  last_error        text check (last_error is null or length(last_error) <= 300),
  run_id            uuid,
  run_full          boolean not null default false,
  cursors           jsonb not null default '{}'::jsonb,
  counts            jsonb not null default '{}'::jsonb,
  last_webhook_at   timestamptz,
  updated_at        timestamptz not null default now()
);

create table if not exists public.hr_webhook_events (
  org_id      uuid not null references public.organizations(id),
  event_id    text not null check (length(event_id) between 1 and 64),
  event_type  text not null check (length(event_type) between 1 and 60),
  received_at timestamptz not null default now(),
  primary key (org_id, event_id)
);
create index if not exists hr_webhook_events_age_idx on public.hr_webhook_events (received_at);

drop trigger if exists hr_units_updated_at on public.hr_units;
create trigger hr_units_updated_at before update on public.hr_units for each row execute function public.set_updated_at();
drop trigger if exists hr_employees_updated_at on public.hr_employees;
create trigger hr_employees_updated_at before update on public.hr_employees for each row execute function public.set_updated_at();

alter table public.hr_units enable row level security;
alter table public.hr_employees enable row level security;
alter table public.hr_sync_state enable row level security;
alter table public.hr_webhook_events enable row level security;
revoke all on public.hr_units, public.hr_employees, public.hr_sync_state, public.hr_webhook_events from anon, authenticated;

-- Branches and departments: every member (the directory). Employees: every member, directory columns only (column grants);
-- work email, ERP link and dates come only through hr_directory for owners and admins. Sync state: owners and admins.
-- Webhook events: nobody but the service role.
grant select on public.hr_units to authenticated;
grant select (id, org_id, external_id, employee_number, display_name, display_name_ar, job_title, job_title_ar,
              branch_external_id, department_external_id, manager_external_id, status, created_at, updated_at, deleted_at)
  on public.hr_employees to authenticated;
grant select on public.hr_sync_state to authenticated;

drop policy if exists hr_units_member_read on public.hr_units;
create policy hr_units_member_read on public.hr_units for select to authenticated using (public.is_org_member(org_id));
drop policy if exists hr_employees_member_read on public.hr_employees;
create policy hr_employees_member_read on public.hr_employees for select to authenticated using (public.is_org_member(org_id));
drop policy if exists hr_sync_state_admin_read on public.hr_sync_state;
create policy hr_sync_state_admin_read on public.hr_sync_state for select to authenticated
  using (exists (select 1 from public.memberships m where m.org_id = hr_sync_state.org_id and m.user_id = (select auth.uid())
                  and m.disabled_at is null and m.role in ('owner', 'admin')));

-- ---------------------------------------------------------------- for people (own sign-in)

-- The directory. Members: name, number, job, branch, department, manager, status. Owners and admins also: work email, hire and
-- leave dates, the linked ERP member, and a suggested member (same sign-in email, only when exactly one active member matches).
create or replace function public.hr_directory(p_q text default null, p_branch text default null, p_department text default null,
  p_status text default null, p_limit int default 50, p_offset int default 0) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_org uuid := public.current_org_id(); v_admin boolean; v_q text := nullif(trim(coalesce(p_q, '')), ''); v_total bigint; v_rows jsonb;
begin
  if v_org is null or not public.is_org_member(v_org) then raise exception 'FORBIDDEN'; end if;
  if p_status is not null and p_status not in ('active', 'on_leave', 'terminated') then raise exception 'INVALID_INPUT' using detail = 'unknown status'; end if;
  if coalesce(p_limit, 0) not between 1 and 200 or coalesce(p_offset, -1) < 0 then raise exception 'INVALID_INPUT' using detail = 'limit 1-200'; end if;
  v_admin := exists (select 1 from public.memberships m where m.org_id = v_org and m.user_id = auth.uid() and m.disabled_at is null and m.role in ('owner', 'admin'));
  with f as (
    select e.* from public.hr_employees e
     where e.org_id = v_org and e.deleted_at is null
       and (p_status is null or e.status = p_status)
       and (p_branch is null or e.branch_external_id = p_branch)
       and (p_department is null or e.department_external_id = p_department)
       and (v_q is null or e.display_name ilike '%' || v_q || '%' or coalesce(e.display_name_ar, '') ilike '%' || v_q || '%'
            or coalesce(e.employee_number, '') ilike '%' || v_q || '%' or coalesce(e.job_title, '') ilike '%' || v_q || '%')
  )
  select (select count(*) from f),
         coalesce(jsonb_agg(row_to_json(x)::jsonb - 'name_sort' order by x.name_sort), '[]'::jsonb)
    into v_total, v_rows
    from (
      select lower(e.display_name) as name_sort,
             e.id, e.external_id as "externalId", e.employee_number as "employeeNumber", e.display_name as "displayName",
             e.display_name_ar as "displayNameAr", e.job_title as "jobTitle", e.job_title_ar as "jobTitleAr", e.status,
             b.name as "branchName", b.name_ar as "branchNameAr", d.name as "departmentName", d.name_ar as "departmentNameAr",
             mg.display_name as "managerName",
             case when v_admin then e.work_email end as "workEmail",
             case when v_admin then e.hired_on end as "hiredOn",
             case when v_admin then e.left_on end as "leftOn",
             case when v_admin then e.user_id end as "userId",
             case when v_admin then e.link_source end as "linkSource",
             case when v_admin and e.user_id is not null then
               (select m.role from public.memberships m where m.org_id = v_org and m.user_id = e.user_id and m.disabled_at is null) end as "memberRole",
             case when v_admin and e.user_id is null and e.work_email is not null then
               (select min(u.id::text)::uuid from public.memberships m join auth.users u on u.id = m.user_id
                 where m.org_id = v_org and m.disabled_at is null and lower(u.email) = e.work_email
                   and not exists (select 1 from public.hr_employees o where o.org_id = v_org and o.user_id = m.user_id and o.deleted_at is null)
                having count(*) = 1) end as "suggestedUserId"
        from f e
        left join public.hr_units b on b.org_id = v_org and b.kind = 'branch' and b.external_id = e.branch_external_id and b.deleted_at is null
        left join public.hr_units d on d.org_id = v_org and d.kind = 'department' and d.external_id = e.department_external_id and d.deleted_at is null
        left join public.hr_employees mg on mg.org_id = v_org and mg.external_id = e.manager_external_id and mg.deleted_at is null
       order by lower(e.display_name), e.id
       limit p_limit offset p_offset
    ) x;
  return jsonb_build_object('total', v_total, 'rows', v_rows, 'details', v_admin);
end $$;

-- "Sync now": the 5-minute job reads within 5 minutes. Owners and admins; at most once a minute.
create or replace function public.hr_request_sync() returns timestamptz
language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.require_org_role(array['owner', 'admin']); s public.hr_sync_state; i public.core_integrations;
begin
  select * into i from public.core_integrations where org_id = v_org and kind = 'hr_app';
  if not found or not i.enabled then raise exception 'INVALID_STATE' using detail = 'switch the HR app on first'; end if;
  insert into public.hr_sync_state (org_id) values (v_org) on conflict (org_id) do nothing;
  select * into s from public.hr_sync_state where org_id = v_org for update;
  if s.requested_at is not null and s.requested_at > now() - interval '1 minute' then
    raise exception 'TOO_SOON' using detail = 'a sync was asked for less than a minute ago';
  end if;
  update public.hr_sync_state set requested_at = now(), updated_at = now() where org_id = v_org;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary)
  values (v_org, auth.uid(), 'hr.sync.requested', 'integration', i.id::text, 'HR app sync asked for');
  return now();
end $$;

-- Link an employee to an ERP member of the same company (owners and admins). One employee per member.
create or replace function public.hr_link_employee(p_employee uuid, p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.require_org_role(array['owner', 'admin']); e public.hr_employees; v_src text;
begin
  select * into e from public.hr_employees where org_id = v_org and id = p_employee and deleted_at is null for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if not exists (select 1 from public.memberships m where m.org_id = v_org and m.user_id = p_user and m.disabled_at is null) then
    raise exception 'NOT_FOUND' using detail = 'that person is not an active member of this company';
  end if;
  if e.user_id = p_user then return; end if;
  if exists (select 1 from public.hr_employees o where o.org_id = v_org and o.user_id = p_user and o.deleted_at is null) then
    raise exception 'DUPLICATE' using detail = 'that member is already linked to another employee';
  end if;
  v_src := case when e.work_email is not null and exists (select 1 from auth.users u where u.id = p_user and lower(u.email) = e.work_email)
                then 'confirmed' else 'manual' end;
  update public.hr_employees set user_id = p_user, link_source = v_src where id = e.id;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary, before, after)
  values (v_org, auth.uid(), 'hr.employee.linked', 'hr_employee', e.id::text, format('%s linked to an ERP member (%s)', e.display_name, v_src),
          jsonb_build_object('user_id', e.user_id), jsonb_build_object('user_id', p_user, 'link_source', v_src));
end $$;

create or replace function public.hr_unlink_employee(p_employee uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.require_org_role(array['owner', 'admin']); e public.hr_employees;
begin
  select * into e from public.hr_employees where org_id = v_org and id = p_employee for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if e.user_id is null then return; end if;
  update public.hr_employees set user_id = null, link_source = null where id = e.id;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary, before)
  values (v_org, auth.uid(), 'hr.employee.unlinked', 'hr_employee', e.id::text, format('%s unlinked from its ERP member', e.display_name),
          jsonb_build_object('user_id', e.user_id, 'link_source', e.link_source));
end $$;

-- Map an HR branch to one of the company's ERP branches, or clear it (owners and admins).
create or replace function public.hr_map_branch(p_unit uuid, p_core_branch uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.require_org_role(array['owner', 'admin']); u public.hr_units; v_name text;
begin
  select * into u from public.hr_units where org_id = v_org and id = p_unit and kind = 'branch' and deleted_at is null for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if p_core_branch is not null then
    select name into v_name from public.core_branches where org_id = v_org and id = p_core_branch and deleted_at is null;
    if v_name is null then raise exception 'NOT_FOUND' using detail = 'unknown ERP branch'; end if;
  end if;
  if u.core_branch_id is not distinct from p_core_branch then return; end if;
  update public.hr_units set core_branch_id = p_core_branch where id = u.id;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary, before, after)
  values (v_org, auth.uid(), 'hr.branch.mapped', 'hr_unit', u.id::text,
          format('HR branch %s %s', u.name, case when p_core_branch is null then 'no longer mapped' else 'mapped to ERP branch ' || v_name end),
          jsonb_build_object('core_branch_id', u.core_branch_id), jsonb_build_object('core_branch_id', p_core_branch));
end $$;

revoke all on function public.hr_directory(text, text, text, text, int, int), public.hr_request_sync(), public.hr_link_employee(uuid, uuid),
  public.hr_unlink_employee(uuid), public.hr_map_branch(uuid, uuid) from public, anon;
grant execute on function public.hr_directory(text, text, text, text, int, int), public.hr_request_sync(), public.hr_link_employee(uuid, uuid),
  public.hr_unlink_employee(uuid), public.hr_map_branch(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------- for the sync job and the webhook (service role only)

-- Companies to read now: HR app on, and asked for (Sync now or a webhook) or older than their interval; not while a run is going
-- (a run older than 10 minutes counts as dead). Asked-for first. Each with its details and whether a full read is due (daily).
create or replace function public.hr__sync_due(p_limit int default 20) returns table (org_id uuid, full_read boolean, credentials jsonb, connection_id text, subscription_id text)
language sql stable security definer set search_path = public as $$
  select i.org_id,
         s.last_full_at is null or s.last_full_at < now() - interval '1 day',
         public.core__provider_credentials(i.org_id, 'hr_app'),
         i.settings ->> 'hr_connection_id',
         i.settings ->> 'hr_subscription_id'
    from public.core_integrations i
    left join public.hr_sync_state s on s.org_id = i.org_id
   where i.kind = 'hr_app' and i.enabled
     and not (s.last_started_at is not null and (s.last_finished_at is null or s.last_started_at > s.last_finished_at)
              and s.last_started_at > now() - interval '10 minutes')
     and (s.org_id is null or s.last_finished_at is null
          or (s.requested_at is not null and s.requested_at > coalesce(s.last_started_at, '-infinity'))
          or s.last_finished_at < now() - make_interval(mins => s.interval_minutes))
   order by (s.requested_at is not null and s.requested_at > coalesce(s.last_started_at, '-infinity')) desc, s.last_finished_at nulls first
   limit greatest(1, least(coalesce(p_limit, 20), 100));
$$;

-- Start a run: claims the company (false when another run holds it) and returns the cursors.
create or replace function public.hr__begin_sync(p_org uuid, p_full boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.hr_sync_state; v_run uuid := gen_random_uuid();
begin
  insert into public.hr_sync_state (org_id) values (p_org) on conflict (org_id) do nothing;
  select * into s from public.hr_sync_state where org_id = p_org for update;
  if s.last_started_at is not null and (s.last_finished_at is null or s.last_started_at > s.last_finished_at)
     and s.last_started_at > now() - interval '10 minutes' then
    return null;
  end if;
  update public.hr_sync_state set last_started_at = now(), run_id = v_run, run_full = coalesce(p_full, false), updated_at = now() where org_id = p_org;
  return jsonb_build_object('runId', v_run, 'cursors', s.cursors);
end $$;

-- One page of branches or departments. Older copies never overwrite newer ones; tombstones soft-delete; unknown fields ignored.
create or replace function public.hr__apply_units(p_org uuid, p_run uuid, p_kind text, p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r jsonb; u public.hr_units; v_ts timestamptz; v_added int := 0; v_changed int := 0; v_removed int := 0; v_skipped int := 0;
begin
  if p_kind not in ('branch', 'department') or jsonb_typeof(p_rows) <> 'array' then raise exception 'INVALID_INPUT'; end if;
  if jsonb_array_length(p_rows) > 200 then raise exception 'INVALID_INPUT' using detail = 'a page holds at most 200 records'; end if;
  if not exists (select 1 from public.hr_sync_state where org_id = p_org and run_id = p_run) then raise exception 'INVALID_STATE' using detail = 'not the current run'; end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    begin
      v_ts := (r ->> 'updated_at')::timestamptz;
      if coalesce(r ->> 'id', '') = '' or length(r ->> 'id') > 64 or v_ts is null then v_skipped := v_skipped + 1; continue; end if;
      select * into u from public.hr_units where org_id = p_org and kind = p_kind and external_id = r ->> 'id' for update;
      if found and u.source_updated_at > v_ts then
        update public.hr_units set last_seen_run = p_run where id = u.id;
        continue;
      end if;
      if coalesce((r ->> 'deleted')::boolean, false) then
        if found and u.deleted_at is null then
          update public.hr_units set deleted_at = now(), source_updated_at = v_ts where id = u.id;
          v_removed := v_removed + 1;
        end if;
        continue;
      end if;
      if found then
        update public.hr_units set code = left(nullif(trim(r ->> 'code'), ''), 30), name = left(trim(r ->> 'name'), 120),
               name_ar = left(nullif(trim(r ->> 'name_ar'), ''), 120),
               branch_external_id = case when p_kind = 'department' then left(nullif(r ->> 'branch_id', ''), 64) end,
               parent_external_id = case when p_kind = 'department' then left(nullif(r ->> 'parent_department_id', ''), 64) end,
               active = coalesce((r ->> 'active')::boolean, true), source_updated_at = v_ts, last_seen_run = p_run, deleted_at = null
         where id = u.id;
        v_changed := v_changed + 1;
      else
        insert into public.hr_units (org_id, kind, external_id, code, name, name_ar, branch_external_id, parent_external_id, active, source_updated_at, last_seen_run, core_branch_id)
        values (p_org, p_kind, r ->> 'id', left(nullif(trim(r ->> 'code'), ''), 30), left(trim(r ->> 'name'), 120), left(nullif(trim(r ->> 'name_ar'), ''), 120),
                case when p_kind = 'department' then left(nullif(r ->> 'branch_id', ''), 64) end,
                case when p_kind = 'department' then left(nullif(r ->> 'parent_department_id', ''), 64) end,
                coalesce((r ->> 'active')::boolean, true), v_ts, p_run,
                -- a new HR branch is mapped to the ERP branch with the same code, when exactly one exists (a person can change it)
                case when p_kind = 'branch' and nullif(trim(r ->> 'code'), '') is not null then
                  (select min(b.id::text)::uuid from public.core_branches b where b.org_id = p_org and b.deleted_at is null
                     and upper(b.code) = upper(trim(r ->> 'code')) having count(*) = 1) end);
        v_added := v_added + 1;
      end if;
    exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow or check_violation or not_null_violation then
      v_skipped := v_skipped + 1;
    end;
  end loop;
  return jsonb_build_object('added', v_added, 'changed', v_changed, 'removed', v_removed, 'skipped', v_skipped);
end $$;

-- One page of employees. The ERP's own fields (user_id, link_source) are never touched. A status change of a linked employee is
-- audited (so "terminated in HR but still an ERP member" is traceable).
create or replace function public.hr__apply_employees(p_org uuid, p_run uuid, p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r jsonb; e public.hr_employees; v_ts timestamptz; v_status text; v_email text; v_added int := 0; v_changed int := 0; v_removed int := 0; v_skipped int := 0;
begin
  if jsonb_typeof(p_rows) <> 'array' then raise exception 'INVALID_INPUT'; end if;
  if jsonb_array_length(p_rows) > 200 then raise exception 'INVALID_INPUT' using detail = 'a page holds at most 200 records'; end if;
  if not exists (select 1 from public.hr_sync_state where org_id = p_org and run_id = p_run) then raise exception 'INVALID_STATE' using detail = 'not the current run'; end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    begin
      v_ts := (r ->> 'updated_at')::timestamptz;
      if coalesce(r ->> 'id', '') = '' or length(r ->> 'id') > 64 or v_ts is null then v_skipped := v_skipped + 1; continue; end if;
      select * into e from public.hr_employees where org_id = p_org and external_id = r ->> 'id' for update;
      if found and e.source_updated_at > v_ts then
        update public.hr_employees set last_seen_run = p_run where id = e.id;
        continue;
      end if;
      if coalesce((r ->> 'deleted')::boolean, false) then
        if found and e.deleted_at is null then
          update public.hr_employees set deleted_at = now(), source_updated_at = v_ts where id = e.id;
          v_removed := v_removed + 1;
          if e.user_id is not null then
            insert into public.audit_log (org_id, action, entity_type, entity_id, summary)
            values (p_org, 'hr.employee.removed', 'hr_employee', e.id::text, format('%s removed in the HR app (linked to an ERP member)', e.display_name));
          end if;
        end if;
        continue;
      end if;
      v_status := coalesce(r ->> 'status', 'active');
      if v_status not in ('active', 'on_leave', 'terminated') then v_skipped := v_skipped + 1; continue; end if;
      v_email := lower(nullif(trim(r ->> 'work_email'), ''));
      if v_email is not null and (length(v_email) > 254 or v_email !~ '^[^@\s]+@[^@\s]+$') then v_email := null; end if;
      if found then
        update public.hr_employees set employee_number = left(nullif(trim(r ->> 'employee_number'), ''), 40),
               display_name = left(trim(r ->> 'display_name'), 160), display_name_ar = left(nullif(trim(r ->> 'display_name_ar'), ''), 160),
               work_email = v_email, job_title = left(nullif(trim(r ->> 'job_title'), ''), 120), job_title_ar = left(nullif(trim(r ->> 'job_title_ar'), ''), 120),
               branch_external_id = left(nullif(r ->> 'branch_id', ''), 64), department_external_id = left(nullif(r ->> 'department_id', ''), 64),
               manager_external_id = left(nullif(r ->> 'manager_id', ''), 64), status = v_status,
               hired_on = (r ->> 'hired_on')::date, left_on = (r ->> 'left_on')::date,
               source_updated_at = v_ts, last_seen_run = p_run, deleted_at = null
         where id = e.id;
        v_changed := v_changed + 1;
        if e.user_id is not null and e.status is distinct from v_status then
          insert into public.audit_log (org_id, action, entity_type, entity_id, summary, before, after)
          values (p_org, 'hr.employee.status_changed', 'hr_employee', e.id::text, format('%s is now %s in the HR app (linked to an ERP member)', e.display_name, v_status),
                  jsonb_build_object('status', e.status), jsonb_build_object('status', v_status));
        end if;
      else
        insert into public.hr_employees (org_id, external_id, employee_number, display_name, display_name_ar, work_email, job_title, job_title_ar,
          branch_external_id, department_external_id, manager_external_id, status, hired_on, left_on, source_updated_at, last_seen_run)
        values (p_org, r ->> 'id', left(nullif(trim(r ->> 'employee_number'), ''), 40), left(trim(r ->> 'display_name'), 160),
                left(nullif(trim(r ->> 'display_name_ar'), ''), 160), v_email, left(nullif(trim(r ->> 'job_title'), ''), 120),
                left(nullif(trim(r ->> 'job_title_ar'), ''), 120), left(nullif(r ->> 'branch_id', ''), 64), left(nullif(r ->> 'department_id', ''), 64),
                left(nullif(r ->> 'manager_id', ''), 64), v_status, (r ->> 'hired_on')::date, (r ->> 'left_on')::date, v_ts, p_run);
        v_added := v_added + 1;
      end if;
    exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow or check_violation or not_null_violation then
      v_skipped := v_skipped + 1;
    end;
  end loop;
  return jsonb_build_object('added', v_added, 'changed', v_changed, 'removed', v_removed, 'skipped', v_skipped);
end $$;

-- End a run: save cursors and the result (also on the integration card); after a complete full read, records the HR app no longer
-- lists are soft-deleted. One audit row per run.
create or replace function public.hr__finish_sync(p_org uuid, p_run uuid, p_result text, p_error text, p_cursors jsonb, p_counts jsonb, p_full_complete boolean)
returns void
language plpgsql security definer set search_path = public as $$
declare s public.hr_sync_state; v_gone int := 0; n int;
begin
  if p_result not in ('ok', 'partial', 'failed') then raise exception 'INVALID_INPUT'; end if;
  select * into s from public.hr_sync_state where org_id = p_org for update;
  if not found or s.run_id is distinct from p_run then raise exception 'INVALID_STATE' using detail = 'not the current run'; end if;
  if coalesce(p_full_complete, false) and s.run_full and p_result = 'ok' then
    update public.hr_units set deleted_at = now() where org_id = p_org and deleted_at is null and last_seen_run is distinct from p_run;
    get diagnostics v_gone = row_count;
    update public.hr_employees set deleted_at = now() where org_id = p_org and deleted_at is null and last_seen_run is distinct from p_run;
    get diagnostics n = row_count; v_gone := v_gone + n;
  end if;
  update public.hr_sync_state
     set last_finished_at = now(), last_result = p_result, last_error = left(nullif(trim(p_error), ''), 300),
         cursors = case when p_result = 'failed' then cursors else coalesce(p_cursors, cursors) end,
         counts = coalesce(p_counts, '{}'::jsonb) || jsonb_build_object('gone', v_gone),
         last_full_at = case when coalesce(p_full_complete, false) and s.run_full and p_result = 'ok' then now() else last_full_at end,
         updated_at = now()
   where org_id = p_org;
  update public.core_integrations
     set last_status = case when p_result = 'failed' then 'failed' else 'sent' end,
         last_error = case when p_result = 'ok' then null else left(coalesce(nullif(trim(p_error), ''), 'partly read'), 300) end,
         last_delivery_at = now()
   where org_id = p_org and kind = 'hr_app';
  insert into public.audit_log (org_id, action, entity_type, entity_id, summary, after)
  values (p_org, 'hr.sync.finished', 'hr_sync', p_org::text,
          format('HR app sync %s%s', p_result, case when p_error is null then '' else ': ' || left(p_error, 200) end),
          coalesce(p_counts, '{}'::jsonb) || jsonb_build_object('gone', v_gone, 'full', s.run_full));
end $$;

-- After the ERP registered its webhook with the HR app: keep the subscription id and the signing secret (Vault, never shown).
create or replace function public.hr__save_subscription(p_org uuid, p_subscription_id text, p_signing_secret text) returns void
language plpgsql security definer set search_path = public, vault as $$
declare r public.core_integrations; v_bundle jsonb;
begin
  if coalesce(p_subscription_id, '') = '' or length(p_subscription_id) > 64 or length(coalesce(p_signing_secret, '')) not between 16 and 512 then
    raise exception 'INVALID_INPUT';
  end if;
  select * into r from public.core_integrations where org_id = p_org and kind = 'hr_app' for update;
  if not found or r.secret_id is null then raise exception 'NOT_FOUND'; end if;
  select coalesce(nullif(d.decrypted_secret, '')::jsonb, '{}'::jsonb) into v_bundle from vault.decrypted_secrets d where d.id = r.secret_id;
  perform vault.update_secret(r.secret_id, (v_bundle || jsonb_build_object('signing_secret', p_signing_secret))::text);
  update public.core_integrations set settings = settings || jsonb_build_object('hr_subscription_id', p_subscription_id) where id = r.id;
  insert into public.audit_log (org_id, action, entity_type, entity_id, summary)
  values (p_org, 'hr.webhook.registered', 'integration', r.id::text, 'ERP webhook registered with the HR app');   -- never the secret
end $$;

-- The webhook: the company and its signing secret, found by OUR connection id; only while the HR app is on.
create or replace function public.hr__accept_webhook(p_connection_id text) returns jsonb
language sql stable security definer set search_path = public, vault as $$
  select jsonb_build_object('orgId', i.org_id,
           'secret', (select nullif(d.decrypted_secret, '')::jsonb ->> 'signing_secret' from vault.decrypted_secrets d where d.id = i.secret_id))
    from public.core_integrations i
   where i.kind = 'hr_app' and i.enabled and p_connection_id ~ '^hrc_[A-Za-z0-9]{24}$'
     and i.settings ->> 'hr_connection_id' = p_connection_id;
$$;

-- A verified webhook: replays answer 'duplicate'; anything that changes data asks for a read.
create or replace function public.hr__record_webhook(p_org uuid, p_event_id text, p_type text) returns text
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(p_event_id, '') = '' or length(p_event_id) > 64 or coalesce(p_type, '') = '' or length(p_type) > 60 then raise exception 'INVALID_INPUT'; end if;
  delete from public.hr_webhook_events where received_at < now() - interval '7 days';
  insert into public.hr_webhook_events (org_id, event_id, event_type) values (p_org, p_event_id, p_type) on conflict do nothing;
  if not found then return 'duplicate'; end if;
  insert into public.hr_sync_state (org_id) values (p_org) on conflict (org_id) do nothing;
  update public.hr_sync_state
     set last_webhook_at = now(),
         requested_at = case when p_type ~ '^(branch|department|employee)\.' or p_type = 'sync.requested' then now() else requested_at end,
         updated_at = now()
   where org_id = p_org;
  if p_type = 'connection.revoked' then
    update public.core_integrations set enabled = false where org_id = p_org and kind = 'hr_app';
    insert into public.audit_log (org_id, action, entity_type, entity_id, summary)
    values (p_org, 'hr.disconnected', 'integration', p_org::text, 'The HR app disconnected the ERP; the HR app integration is switched off');
  end if;
  return 'ok';
end $$;

revoke all on function public.hr__sync_due(int), public.hr__begin_sync(uuid, boolean), public.hr__apply_units(uuid, uuid, text, jsonb),
  public.hr__apply_employees(uuid, uuid, jsonb), public.hr__finish_sync(uuid, uuid, text, text, jsonb, jsonb, boolean),
  public.hr__save_subscription(uuid, text, text), public.hr__accept_webhook(text), public.hr__record_webhook(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.hr__sync_due(int), public.hr__begin_sync(uuid, boolean), public.hr__apply_units(uuid, uuid, text, jsonb),
  public.hr__apply_employees(uuid, uuid, jsonb), public.hr__finish_sync(uuid, uuid, text, text, jsonb, jsonb, boolean),
  public.hr__save_subscription(uuid, text, text), public.hr__accept_webhook(text), public.hr__record_webhook(uuid, text, text)
  to service_role;

commit;

-- Read-only verification. Expect: tables_with_rls 4, users_insert_employees false, users_read_work_email false,
-- users_read_names true, anon_directory false, users_sync_due false, hr_kind_allowed true.
select (select count(*) from pg_class where relname in ('hr_units', 'hr_employees', 'hr_sync_state', 'hr_webhook_events') and relrowsecurity) as tables_with_rls,
       has_table_privilege('authenticated', 'public.hr_employees', 'insert') as users_insert_employees,
       has_column_privilege('authenticated', 'public.hr_employees', 'work_email', 'select') as users_read_work_email,
       has_column_privilege('authenticated', 'public.hr_employees', 'display_name', 'select') as users_read_names,
       has_function_privilege('anon', 'public.hr_directory(text, text, text, text, int, int)', 'execute') as anon_directory,
       has_function_privilege('authenticated', 'public.hr__sync_due(int)', 'execute') as users_sync_due,
       position('hr_app' in pg_get_constraintdef((select oid from pg_constraint where conname = 'core_integrations_kind_check'))) > 0 as hr_kind_allowed;
