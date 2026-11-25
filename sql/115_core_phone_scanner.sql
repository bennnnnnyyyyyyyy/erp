-- sql/115_core_phone_scanner.sql
-- The phone as a barcode scanner for the computer (.temp/2026-11-25-phone-scanner-plan.md; Ben's answers 25 Nov 2026 via erp-master:
-- polling every 1.5 s, sales and purchase orders first, the same person only).
-- 1. core_scan_sessions: the computer's order form starts one (core_scan_start) and shows a QR of a link with a random code. Only a
--    hash of the code is stored. The session belongs to one person in one company, is for one form (sales_order or purchase_order),
--    expires 10 minutes after the last scan (at most 2 hours after it started) and ends when the computer stops it.
-- 2. The phone, signed in as the SAME person in the SAME company, opens the link (core_scan_join) and sends barcodes
--    (core_scan_add): barcode text only, 1-64 printable characters, at most 5 a second. A scan never changes a record: the computer
--    reads the scans (core_scan_poll, every 1.5 s) and adds the items to the form; the person saves the order as before.
-- 3. Row level security: a person reads only their own sessions and scans. Select only; writes through the functions. Start and end
--    are audited; single scans are not (they change nothing). Sessions and scans older than 7 days are removed when the same company
--    starts a new session (they hold no business data).
-- No master key: every call uses the person's own sign-in.
-- Rerun-safe. Needs sql/001-114. Then run sql/tests/112_core_phone_scanner.sql and sql/tests/092_column_grants.sql. Ends with read-only
-- checks.

begin;

create table if not exists public.core_scan_sessions (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations(id),
  user_id      uuid not null references auth.users(id),
  form         text not null check (form in ('sales_order', 'purchase_order')),
  code_hash    text not null unique check (code_hash ~ '^[0-9a-f]{64}$'),
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null,
  last_scan_at timestamptz,
  ended_at     timestamptz,
  unique (org_id, id)
);
create index if not exists core_scan_sessions_user_idx on public.core_scan_sessions (org_id, user_id, created_at desc);

create table if not exists public.core_scan_events (
  id         bigint generated always as identity primary key,
  org_id     uuid not null references public.organizations(id),
  session_id uuid not null,
  barcode    text not null check (barcode ~ '^[ -~]{1,64}$'),
  created_at timestamptz not null default now(),
  foreign key (org_id, session_id) references public.core_scan_sessions(org_id, id) on delete cascade
);
create index if not exists core_scan_events_session_idx on public.core_scan_events (session_id, id);

alter table public.core_scan_sessions enable row level security;
alter table public.core_scan_events enable row level security;
revoke all on public.core_scan_sessions, public.core_scan_events from anon, authenticated;
grant select on public.core_scan_sessions, public.core_scan_events to authenticated;
drop policy if exists core_scan_sessions_own on public.core_scan_sessions;
create policy core_scan_sessions_own on public.core_scan_sessions for select to authenticated
  using (user_id = (select auth.uid()) and public.is_org_member(org_id));
drop policy if exists core_scan_events_own on public.core_scan_events;
create policy core_scan_events_own on public.core_scan_events for select to authenticated
  using (exists (select 1 from public.core_scan_sessions s where s.org_id = core_scan_events.org_id and s.id = core_scan_events.session_id
                   and s.user_id = (select auth.uid())) and public.is_org_member(org_id));

-- The open session of this code for the caller (same person, same company), locked; raises NOT_FOUND otherwise (no detail: a
-- link for someone else, an old link and a made-up link all look the same).
create or replace function public.core__scan_session(p_org uuid, p_code text) returns public.core_scan_sessions
language plpgsql security definer set search_path = public as $$
declare s public.core_scan_sessions;
begin
  if p_code is null or p_code !~ '^[0-9a-f]{64}$' then raise exception 'NOT_FOUND'; end if;
  select * into s from public.core_scan_sessions x
   where x.code_hash = encode(sha256(convert_to(p_code, 'UTF8')), 'hex') and x.org_id = p_org and x.user_id = auth.uid()
     and x.ended_at is null and x.expires_at > now()
   for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  return s;
end $$;
revoke all on function public.core__scan_session(uuid, text) from public, anon, authenticated;

-- Start (the computer). Owners, admins and members, with the module of the form switched on. Ends the person's other open sessions.
-- Returns the code once (only its hash is kept).
create or replace function public.core_scan_start(p_form text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_org  uuid := public.require_org_role(array['owner', 'admin', 'member']);
  v_code text := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  v_id   uuid;
  v_exp  timestamptz := now() + interval '10 minutes';
begin
  if p_form is null or p_form not in ('sales_order', 'purchase_order') then raise exception 'INVALID_INPUT' using detail = 'unknown form'; end if;
  if not exists (select 1 from public.org_modules m where m.org_id = v_org and m.disabled_at is null
                    and m.module_key = case p_form when 'sales_order' then 'sales' else 'purchasing' end) then
    raise exception 'MODULE_DISABLED';
  end if;
  update public.core_scan_sessions set ended_at = now() where org_id = v_org and user_id = auth.uid() and ended_at is null;
  delete from public.core_scan_sessions where org_id = v_org and created_at < now() - interval '7 days';
  insert into public.core_scan_sessions (org_id, user_id, form, code_hash, expires_at)
  values (v_org, auth.uid(), p_form, encode(sha256(convert_to(v_code, 'UTF8')), 'hex'), v_exp)
  returning id into v_id;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary)
  values (v_org, auth.uid(), 'core.scanner.started', 'scan_session', v_id::text, format('Phone scanner started for a %s', replace(p_form, '_', ' ')));
  return jsonb_build_object('sessionId', v_id, 'code', v_code, 'form', p_form, 'expiresAt', v_exp);
end $$;
revoke all on function public.core_scan_start(text) from public, anon;
grant execute on function public.core_scan_start(text) to authenticated;

-- The phone opens the link: the session's form and expiry, when it is the caller's own.
create or replace function public.core_scan_join(p_code text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.require_org_role(array['owner', 'admin', 'member']);
  s     public.core_scan_sessions;
begin
  s := public.core__scan_session(v_org, p_code);
  return jsonb_build_object('sessionId', s.id, 'form', s.form, 'expiresAt', s.expires_at,
                            'scans', (select count(*) from public.core_scan_events e where e.session_id = s.id));
end $$;
revoke all on function public.core_scan_join(text) from public, anon;
grant execute on function public.core_scan_join(text) to authenticated;

-- The phone sends one barcode. Extends the session (10 minutes after the last scan, at most 2 hours after the start).
create or replace function public.core_scan_add(p_code text, p_barcode text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.require_org_role(array['owner', 'admin', 'member']);
  s     public.core_scan_sessions;
  v_bc  text := trim(coalesce(p_barcode, ''));
  v_id  bigint;
begin
  s := public.core__scan_session(v_org, p_code);
  if v_bc !~ '^[ -~]{1,64}$' then raise exception 'INVALID_INPUT' using detail = 'not a barcode'; end if;
  if (select count(*) from public.core_scan_events e where e.session_id = s.id and e.created_at > now() - interval '1 second') >= 5 then
    raise exception 'INVALID_INPUT' using detail = 'too many scans at once';
  end if;
  insert into public.core_scan_events (org_id, session_id, barcode) values (v_org, s.id, v_bc) returning id into v_id;
  update public.core_scan_sessions set last_scan_at = now(), expires_at = least(now() + interval '10 minutes', created_at + interval '2 hours')
   where id = s.id;
  return jsonb_build_object('id', v_id, 'barcode', v_bc);
end $$;
revoke all on function public.core_scan_add(text, text) from public, anon;
grant execute on function public.core_scan_add(text, text) to authenticated;

-- The computer asks for new scans (every 1.5 s): those after p_after, and whether the session is still open.
create or replace function public.core_scan_poll(p_session_id uuid, p_after bigint default 0) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_org uuid := public.require_org_role(array['owner', 'admin', 'member']);
  s     public.core_scan_sessions;
begin
  select * into s from public.core_scan_sessions x where x.org_id = v_org and x.id = p_session_id and x.user_id = auth.uid();
  if not found then raise exception 'NOT_FOUND'; end if;
  return jsonb_build_object(
    'open', s.ended_at is null and s.expires_at > now(), 'expiresAt', s.expires_at,
    'scans', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'barcode', e.barcode) order by e.id)
                         from (select * from public.core_scan_events e where e.session_id = s.id and e.id > coalesce(p_after, 0) order by e.id limit 100) e),
                      '[]'::jsonb));
end $$;
revoke all on function public.core_scan_poll(uuid, bigint) from public, anon;
grant execute on function public.core_scan_poll(uuid, bigint) to authenticated;

-- The computer stops it (or closes the form). Audited.
create or replace function public.core_scan_end(p_session_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.require_org_role(array['owner', 'admin', 'member']);
  s     public.core_scan_sessions;
begin
  select * into s from public.core_scan_sessions x where x.org_id = v_org and x.id = p_session_id and x.user_id = auth.uid() for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if s.ended_at is not null then return; end if;
  update public.core_scan_sessions set ended_at = now() where id = s.id;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary)
  values (v_org, auth.uid(), 'core.scanner.ended', 'scan_session', s.id::text,
          format('Phone scanner stopped (%s scans)', (select count(*) from public.core_scan_events e where e.session_id = s.id)));
end $$;
revoke all on function public.core_scan_end(uuid) from public, anon;
grant execute on function public.core_scan_end(uuid) to authenticated;

commit;

-- ---------------------------------------------------------------- verification (read-only)
-- Expect: true, true, false, false, true, false.
select exists (select 1 from pg_class where relname = 'core_scan_sessions' and relrowsecurity) as sessions_rls,
       exists (select 1 from pg_class where relname = 'core_scan_events' and relrowsecurity) as events_rls,
       has_table_privilege('authenticated', 'public.core_scan_events', 'insert') as users_insert_scans,
       has_table_privilege('anon', 'public.core_scan_sessions', 'select') as anon_read,
       has_function_privilege('authenticated', 'public.core_scan_add(text,text)', 'execute') as users_scan,
       has_function_privilege('anon', 'public.core_scan_start(text)', 'execute') as anon_start;
