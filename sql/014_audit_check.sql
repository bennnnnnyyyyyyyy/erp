-- 014_audit_check.sql
-- O3 (documentation/plans/FEATURE_SET_AND_TECH_STACK.md): scheduled verification of every organization's audit chain, with an
-- alert to the owners if a chain is ever broken. The audit log is tamper-evident (hash chain, sql/003); this is what actually
-- looks. Runs from the scheduled job at most once an hour; every run is recorded in `audit_check_runs` so there is proof it ran.
-- Depends on sql/001-013. Rerun-safe. Run the whole file, then sql/tests/010_audit_check.sql.

begin;

create table if not exists public.audit_check_runs (
  id           uuid primary key default gen_random_uuid(),
  ran_at       timestamptz not null default now(),
  orgs_checked int not null,
  broken_orgs  int not null,
  details      jsonb not null default '[]'::jsonb
);
alter table public.audit_check_runs enable row level security;
revoke all on public.audit_check_runs from anon, authenticated;   -- operational record: service role only

-- Checks every organization. Returns {skipped:true} if it already ran within the last hour (unless forced).
-- A broken chain queues one 'alert' message per owner (once per first bad sequence number) when the messaging module is on.
create or replace function public.audit_check_all(p_force boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  o       record;
  b       record;
  v_last  timestamptz;
  v_n     int := 0;
  v_broken jsonb := '[]'::jsonb;
  m       record;
begin
  select max(r.ran_at) into v_last from public.audit_check_runs r;
  if not p_force and v_last is not null and v_last > now() - interval '1 hour' then
    return jsonb_build_object('skipped', true, 'last_run', v_last);
  end if;

  for o in select og.id from public.organizations og where og.deleted_at is null loop
    v_n := v_n + 1;
    select * into b from public.audit_verify(o.id) limit 1;
    if found then
      v_broken := v_broken || jsonb_build_object('org_id', o.id, 'first_bad_seq', b.first_bad_seq, 'reason', b.reason);
      for m in select u.user_id from public.msg__managers(o.id, array['owner']) u loop
        perform public.msg__enqueue(o.id, m.user_id, 'alert', 'Audit log check failed',
          format('The audit log chain is broken at entry %s (%s). Please contact support.', b.first_bad_seq, b.reason),
          'organization', o.id, format('auditbreak:%s:%s:%s', o.id, b.first_bad_seq, m.user_id));
      end loop;
    end if;
  end loop;

  insert into public.audit_check_runs (orgs_checked, broken_orgs, details) values (v_n, jsonb_array_length(v_broken), v_broken);
  return jsonb_build_object('skipped', false, 'orgs_checked', v_n, 'broken', v_broken);
end $$;

revoke all on function public.audit_check_all(boolean) from public, anon, authenticated;
grant execute on function public.audit_check_all(boolean) to service_role;

commit;

-- Verification (read-only): signed-in users cannot run it or read the run table (expect false, false).
select has_function_privilege('authenticated', 'public.audit_check_all(boolean)', 'execute') as can_run,
       has_table_privilege('authenticated', 'public.audit_check_runs', 'select') as can_read_runs;
